
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import {
  fechaSoloDia, franjasSeSolapan, hoy, lunesDe, sumarDias, validarRangoHoras,
} from './helpers/horarios';
import type { CrearTurnoDto, BulkCrearTurnosDto } from './dto/crear-turno.dto';
import type { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import type { FiltrarTurnosDto, VistaSemanalDto } from './dto/filtrar-turnos.dto';
import type { DuplicarDiaDto, DuplicarSemanaDto } from './dto/duplicar-semana.dto';
import type { AsignarEncargadoDto } from './dto/asignar-encargado.dto';
import type { DiaSemanal } from './interfaces/turno-semanal.interface';

export const CACHE_SEMANA = (negocioId: string, sucursalId: string, lunes: string) =>
  `turnos:semana:${negocioId}:${sucursalId}:${lunes}`;
export const TTL_SEMANA = 600; // 10 min

export const CACHE_ENCARGADO = (negocioId: string, sucursalId: string, fecha: string) =>
  `turnos:encargado:${negocioId}:${sucursalId}:${fecha}`;
export const TTL_ENCARGADO = 3600; // 1 h

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export interface CtxTurno {
  empleadoId: string;
  rol: string;
  sucursalId?: string | null;
  ip?: string;
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
  ) {}

  private esPrivilegiado(rol?: string) {
    return rol === 'DUENO' || rol === 'ENCARGADO';
  }

  /** Invalida las vistas semanales afectadas (la de la sucursal y la de "todas"). */
  async invalidarSemana(negocioId: string, fecha: Date | string, sucursalId?: string | null) {
    const f = typeof fecha === 'string' ? fecha : fecha.toISOString().slice(0, 10);
    const lunes = lunesDe(f);
    const claves = [
      CACHE_SEMANA(negocioId, 'todas', lunes),
      ...(sucursalId ? [CACHE_SEMANA(negocioId, sucursalId, lunes)] : []),
    ];
    for (const k of claves) await this.redis.del(k).catch(() => undefined);
  }

  async invalidarEncargado(negocioId: string, fecha: string, sucursalId: string) {
    await this.redis.del(CACHE_ENCARGADO(negocioId, sucursalId, fecha)).catch(() => undefined);
  }

  /** Sucursal del turno: la del empleado, salvo que un privilegiado la explicite. */
  private async resolverSucursalDelTurno(
    negocioId: string, empleadoId: string, ctx: CtxTurno, sucursalIdDto?: string,
  ) {
    if (this.esPrivilegiado(ctx.rol) && sucursalIdDto) {
      const s = await this.prisma.sucursal.findFirst({
        where: { id: sucursalIdDto, negocioId }, select: { id: true },
      });
      if (!s) throw new NotFoundException('Sucursal no encontrada en este negocio');
      return s.id;
    }
    // No privilegiado: SIEMPRE su propia sucursal (no puede programar en otra)
    const propia = await this.resolver.resolverSucursalDeEmpleado(empleadoId);
    if (!propia) throw new BadRequestException('El empleado no tiene sucursal asignada');
    return propia.id as string;
  }

  /** Verifica solapamiento del empleado ESE dia contra sus otros turnos. */
  private async exigirSinSolapamiento(
    negocioId: string, empleadoId: string, fecha: Date,
    horaInicio: string, horaFin: string, excluirTurnoId?: string, horasDelMismoBulk: Array<{horaInicio: string; horaFin: string}> = [],
  ) {
    validarRangoHoras(horaInicio, horaFin);

    const existentes = await this.prisma.turno.findMany({
      where: {
        negocioId, empleadoId, fecha,
        ...(excluirTurnoId ? { id: { not: excluirTurnoId } } : {}),
      },
      select: { id: true, horaInicio: true, horaFin: true },
    });

    for (const t of existentes) {
      if (franjasSeSolapan(horaInicio, horaFin, t.horaInicio, t.horaFin)) {
        throw new ConflictException(
          `El empleado ya tiene un turno que se solapa ese dia (${t.horaInicio}-${t.horaFin})`,
        );
      }
    }
    for (const t of horasDelMismoBulk) {
      if (franjasSeSolapan(horaInicio, horaFin, t.horaInicio, t.horaFin)) {
        throw new ConflictException(
          `Hay dos turnos del mismo empleado que se solapan ese dia (${t.horaInicio}-${t.horaFin})`,
        );
      }
    }
  }

  // ------------------------------------------------------------------ CRUD ----

  async listar(negocioId: string, filtros: FiltrarTurnosDto, ctx: CtxTurno) {
    const where: Prisma.TurnoWhereInput = { negocioId };

    if (filtros.desde || filtros.hasta) {
      where.fecha = {
        ...(filtros.desde ? { gte: fechaSoloDia(filtros.desde) } : {}),
        ...(filtros.hasta ? { lte: fechaSoloDia(filtros.hasta) } : {}),
      };
    }
    if (filtros.empleadoId) where.empleadoId = filtros.empleadoId;
    if (filtros.tipoTurno) where.tipoTurno = filtros.tipoTurno;

    // Sucursal: explicita si es privilegiado, o la propia del empleado
    const privilegiado = this.esPrivilegiado(ctx.rol);
    const sucursalFiltro = privilegiado ? filtros.sucursalId ?? null : ctx.sucursalId ?? null;
    if (sucursalFiltro) where.sucursalId = sucursalFiltro;

    const data = await this.prisma.turno.findMany({
      where,
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
      include: {
        empleado: { select: { id: true, nombre: true, rol: true } },
        sucursal: { select: { id: true, nombre: true, slug: true } },
      },
    });
    return { data, total: data.length };
  }

  /** Vista semanal (Lunes a Domingo) con turnos + encargado de cada dia. */
  async vistaSemanal(negocioId: string, dto: VistaSemanalDto, ctx: CtxTurno): Promise<{ semana: DiaSemanal[]; lunes: string; sucursalId: string }> {
    const privilegiado = this.esPrivilegiado(ctx.rol);
    const sucursalId = (privilegiado ? dto.sucursalId : ctx.sucursalId) ?? 'todas';
    const lunes = lunesDe(dto.fechaInicio ?? hoy());

    const clave = CACHE_SEMANA(negocioId, sucursalId, lunes);
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) {
      const parsed = JSON.parse(cacheado);
      return { ...parsed, cacheado: true } as never;
    }

    const domingo = sumarDias(lunes, 6);
    const whereSucursal = sucursalId !== 'todas' ? { sucursalId } : {};

    const [turnos, encargados] = await Promise.all([
      this.prisma.turno.findMany({
        where: {
          negocioId, ...whereSucursal,
          fecha: { gte: fechaSoloDia(lunes), lte: fechaSoloDia(domingo) },
        },
        orderBy: [{ horaInicio: 'asc' }],
        include: {
          empleado: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.encargadoDia.findMany({
        where: {
          negocioId, ...whereSucursal,
          fecha: { gte: fechaSoloDia(lunes), lte: fechaSoloDia(domingo) },
        },
        include: { empleado: { select: { id: true, nombre: true } } },
      }),
    ]);

    const semana: DiaSemanal[] = Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDias(lunes, i);
      const enc = encargados.find((e) => e.fecha.toISOString().slice(0, 10) === fecha);
      return {
        fecha,
        diaSemana: DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()],
        turnos: turnos
          .filter((t) => t.fecha.toISOString().slice(0, 10) === fecha)
          .map((t) => ({
            id: t.id, empleadoId: t.empleadoId, empleadoNombre: t.empleado.nombre,
            sucursalId: t.sucursalId, horaInicio: t.horaInicio, horaFin: t.horaFin,
            tipoTurno: t.tipoTurno, notas: t.notas,
          })),
        encargado: enc ? { empleadoId: enc.empleadoId, nombre: enc.empleado.nombre } : null,
      };
    });

    const respuesta = { lunes, sucursalId, semana };
    await this.redis.set(clave, JSON.stringify(respuesta), TTL_SEMANA).catch(() => undefined);
    return { ...respuesta, cacheado: false } as never;
  }

  async turnosDeEmpleadoSemana(negocioId: string, empleadoId: string, fechaInicio: string | undefined, ctx: CtxTurno) {
    if (!this.esPrivilegiado(ctx.rol) && ctx.sucursalId) {
      const emp = await this.prisma.empleado.findFirst({
        where: { id: empleadoId, negocioId, sucursalId: ctx.sucursalId }, select: { id: true },
      });
      if (!emp) throw new NotFoundException('Empleado no encontrado en tu sucursal');
    }
    const lunes = lunesDe(fechaInicio ?? hoy());
    return this.listar(negocioId, { desde: lunes, hasta: sumarDias(lunes, 6), empleadoId }, ctx);
  }

  async obtener(negocioId: string, id: string) {
    const turno = await this.prisma.turno.findFirst({
      where: { id, negocioId },
      include: {
        empleado: { select: { id: true, nombre: true, rol: true } },
        sucursal: { select: { id: true, nombre: true, slug: true } },
      },
    });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    return turno;
  }

  private async exigirEmpleado(negocioId: string, empleadoId: string) {
    const emp = await this.prisma.empleado.findFirst({
      where: { id: empleadoId, negocioId, activo: true, eliminadoEn: null },
      select: { id: true, nombre: true },
    });
    if (!emp) throw new BadRequestException('Empleado inexistente, inactivo o de otro negocio');
    return emp;
  }

  async crear(negocioId: string, dto: CrearTurnoDto, ctx: CtxTurno) {
    await this.exigirEmpleado(negocioId, dto.empleadoId);
    const sucursalId = await this.resolverSucursalDelTurno(negocioId, dto.empleadoId, ctx, dto.sucursalId);
    const fecha = fechaSoloDia(dto.fecha);
    await this.exigirSinSolapamiento(negocioId, dto.empleadoId, fecha, dto.horaInicio, dto.horaFin);

    const turno = await this.prisma.turno.create({
      data: {
        negocioId, sucursalId, empleadoId: dto.empleadoId, fecha,
        horaInicio: dto.horaInicio, horaFin: dto.horaFin,
        tipoTurno: dto.tipoTurno, notas: dto.notas ?? null,
      },
      include: { empleado: { select: { id: true, nombre: true } } },
    });

    await this.invalidarSemana(negocioId, fecha, sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.creado', empleadoId: ctx.empleadoId,
      detalle: { turnoId: turno.id, empleado: turno.empleado.nombre, fecha: dto.fecha, franja: `${dto.horaInicio}-${dto.horaFin}`, tipo: dto.tipoTurno },
      ip: ctx.ip,
    });
    return turno;
  }

  /** Bulk: valida solapamiento tambien CONTRA los otros turnos del mismo lote. */
  async crearBulk(negocioId: string, dto: BulkCrearTurnosDto, ctx: CtxTurno) {
    for (const t of dto.turnos) await this.exigirEmpleado(negocioId, t.empleadoId);

    const procesados: Array<{ empleadoId: string; fecha: string; horaInicio: string; horaFin: string }> = [];
    const pendientes: Array<{ dto: CrearTurnoDto; sucursalId: string; fecha: Date }> = [];

    for (const t of dto.turnos) {
      const fecha = fechaSoloDia(t.fecha);
      const delMismoLote = procesados
        .filter((p) => p.empleadoId === t.empleadoId && p.fecha === t.fecha)
        .map((p) => ({ horaInicio: p.horaInicio, horaFin: p.horaFin }));

      await this.exigirSinSolapamiento(negocioId, t.empleadoId, fecha, t.horaInicio, t.horaFin, undefined, delMismoLote);

      const sucursalId = await this.resolverSucursalDelTurno(negocioId, t.empleadoId, ctx, t.sucursalId);
      pendientes.push({ dto: t, sucursalId, fecha });
      procesados.push({ empleadoId: t.empleadoId, fecha: t.fecha, horaInicio: t.horaInicio, horaFin: t.horaFin });
    }

    const creados = await this.prisma.$transaction(
      pendientes.map((p) => this.prisma.turno.create({
        data: {
          negocioId, sucursalId: p.sucursalId, empleadoId: p.dto.empleadoId, fecha: p.fecha,
          horaInicio: p.dto.horaInicio, horaFin: p.dto.horaFin,
          tipoTurno: p.dto.tipoTurno, notas: p.dto.notas ?? null,
        },
      })),
    );

    for (const p of pendientes) await this.invalidarSemana(negocioId, p.fecha, p.sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.creado', empleadoId: ctx.empleadoId,
      detalle: { bulk: true, cantidad: creados.length }, ip: ctx.ip,
    });
    return { ok: true, creados: creados.length };
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarTurnoDto, ctx: CtxTurno) {
    const actual = await this.prisma.turno.findFirst({
      where: { id, negocioId },
      select: { id: true, empleadoId: true, fecha: true, horaInicio: true, horaFin: true, sucursalId: true },
    });
    if (!actual) throw new NotFoundException('Turno no encontrado');

    const horaInicio = dto.horaInicio ?? actual.horaInicio;
    const horaFin = dto.horaFin ?? actual.horaFin;
    await this.exigirSinSolapamiento(negocioId, actual.empleadoId, actual.fecha, horaInicio, horaFin, id);

    const turno = await this.prisma.turno.update({
      where: { id },
      data: {
        ...(dto.horaInicio !== undefined ? { horaInicio: dto.horaInicio } : {}),
        ...(dto.horaFin !== undefined ? { horaFin: dto.horaFin } : {}),
        ...(dto.tipoTurno !== undefined ? { tipoTurno: dto.tipoTurno } : {}),
        ...(dto.notas !== undefined ? { notas: dto.notas } : {}),
      },
    });

    await this.invalidarSemana(negocioId, actual.fecha, actual.sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.actualizado', empleadoId: ctx.empleadoId,
      detalle: { turnoId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return turno;
  }

  async eliminar(negocioId: string, id: string, ctx: CtxTurno) {
    const turno = await this.prisma.turno.findFirst({
      where: { id, negocioId }, select: { id: true, fecha: true, sucursalId: true, empleadoId: true },
    });
    if (!turno) throw new NotFoundException('Turno no encontrado');

    await this.prisma.turno.delete({ where: { id } });
    await this.invalidarSemana(negocioId, turno.fecha, turno.sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.eliminado', empleadoId: ctx.empleadoId,
      detalle: { turnoId: id }, ip: ctx.ip,
    });
    return { ok: true, eliminado: id };
  }

  /** Duplica una semana completa (lunes a domingo) a otra. */
  async duplicarSemana(negocioId: string, dto: DuplicarSemanaDto, ctx: CtxTurno) {
    const origen = lunesDe(dto.fechaInicioSemanaOrigen);
    const destino = lunesDe(dto.fechaInicioSemanaDestino);
    // Dias de diferencia entre los dos lunes (positivo: se copia hacia adelante)
    const offsetDias = Math.round(
      (fechaSoloDia(destino).getTime() - fechaSoloDia(origen).getTime()) / 86_400_000,
    );

    const turnosOrigen = await this.prisma.turno.findMany({
      where: {
        negocioId,
        fecha: { gte: fechaSoloDia(origen), lte: fechaSoloDia(sumarDias(origen, 6)) },
        ...(ctx.rol !== 'DUENO' && ctx.rol !== 'ENCARGADO' && ctx.sucursalId ? { sucursalId: ctx.sucursalId } : {}),
      },
    });

    const existentesDestino = await this.prisma.turno.count({
      where: { negocioId, fecha: { gte: fechaSoloDia(destino), lte: fechaSoloDia(sumarDias(destino, 6)) } },
    });
    if (existentesDestino > 0 && !dto.sobrescribir) {
      throw new ConflictException(
        `La semana destino ya tiene ${existentesDestino} turno(s). Usa sobrescribir=true para reemplazarlos.`,
      );
    }

    if (dto.sobrescribir && existentesDestino > 0) {
      await this.prisma.turno.deleteMany({
        where: { negocioId, fecha: { gte: fechaSoloDia(destino), lte: fechaSoloDia(sumarDias(destino, 6)) } },
      });
    }

    const nuevos = turnosOrigen.map((t) => {
      const f = new Date(t.fecha);
      f.setUTCDate(f.getUTCDate() + offsetDias);
      return {
        negocioId, sucursalId: t.sucursalId, empleadoId: t.empleadoId,
        fecha: fechaSoloDia(f.toISOString().slice(0, 10)),
        horaInicio: t.horaInicio, horaFin: t.horaFin, tipoTurno: t.tipoTurno, notas: t.notas,
      };
    });

    if (nuevos.length) await this.prisma.turno.createMany({ data: nuevos, skipDuplicates: true });
    await this.invalidarSemana(negocioId, destino);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.semana_duplicada', empleadoId: ctx.empleadoId,
      detalle: { origen, destino, copiados: nuevos.length, sobrescrito: !!dto.sobrescribir }, ip: ctx.ip,
    });
    return { ok: true, origen, destino, copiados: nuevos.length };
  }

  async duplicarDia(negocioId: string, dto: DuplicarDiaDto, ctx: CtxTurno) {
    const fuente = await this.prisma.turno.findMany({
      where: { negocioId, fecha: fechaSoloDia(dto.fechaOrigen) },
    });
    const nuevos = [];
    for (const dest of dto.fechasDestino) {
      for (const t of fuente) {
        nuevos.push({
          negocioId, sucursalId: t.sucursalId, empleadoId: t.empleadoId,
          fecha: fechaSoloDia(dest),
          horaInicio: t.horaInicio, horaFin: t.horaFin, tipoTurno: t.tipoTurno, notas: t.notas,
        });
      }
    }
    if (nuevos.length) await this.prisma.turno.createMany({ data: nuevos, skipDuplicates: true });
    for (const d of dto.fechasDestino) await this.invalidarSemana(negocioId, d);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.dia_duplicado', empleadoId: ctx.empleadoId,
      detalle: { origen: dto.fechaOrigen, destinos: dto.fechasDestino.length, copiados: nuevos.length }, ip: ctx.ip,
    });
    return { ok: true, copiados: nuevos.length };
  }

  /**
   * Duplicado automatico semanal (lo dispara el cron del lunes).
   * Si la semana siguiente YA tiene turnos, no toca nada.
   */
  async duplicarSemanaAutomatica() {
    const negocios = await this.prisma.negocio.findMany({
      where: { activo: true, configuracion: { is: { duplicarSemanaAuto: true } } },
      select: { id: true, nombre: true },
    });

    const resultado: Array<{ negocioId: string; nombre: string; copiados: number; motivo: string }> = [];
    for (const neg of negocios) {
      const origen = lunesDe(hoy());
      const destino = sumarDias(origen, 7);

      const yaHay = await this.prisma.turno.count({
        where: {
          negocioId: neg.id,
          fecha: { gte: fechaSoloDia(destino), lte: fechaSoloDia(sumarDias(destino, 6)) },
        },
      });
      if (yaHay) {
        resultado.push({ negocioId: neg.id, nombre: neg.nombre, copiados: 0, motivo: `la semana siguiente ya tiene ${yaHay} turno(s): no se toca` });
        continue;
      }

      const origenTurnos = await this.prisma.turno.findMany({
        where: {
          negocioId: neg.id,
          fecha: { gte: fechaSoloDia(origen), lte: fechaSoloDia(sumarDias(origen, 6)) },
        },
      });
      if (!origenTurnos.length) {
        resultado.push({ negocioId: neg.id, nombre: neg.nombre, copiados: 0, motivo: 'la semana actual no tiene turnos' });
        continue;
      }

      await this.prisma.turno.createMany({
        data: origenTurnos.map((x) => {
          const f = new Date(x.fecha);
          f.setUTCDate(f.getUTCDate() + 7);
          return {
            negocioId: x.negocioId, sucursalId: x.sucursalId, empleadoId: x.empleadoId,
            fecha: fechaSoloDia(f.toISOString().slice(0, 10)),
            horaInicio: x.horaInicio, horaFin: x.horaFin, tipoTurno: x.tipoTurno, notas: x.notas,
          };
        }),
        skipDuplicates: true,
      });
      await this.invalidarSemana(neg.id, destino);
      await this.auditoria.registrar({
        negocioId: neg.id, accion: 'turno.semana_duplicada',
        detalle: { origen, destino, copiados: origenTurnos.length, automatico: true },
      });
      resultado.push({ negocioId: neg.id, nombre: neg.nombre, copiados: origenTurnos.length, motivo: 'duplicada' });
    }
    return { origen: lunesDe(hoy()), resultado };
  }

  // ------------------------------------------------------------- encargado ----

  /** Asigna el encargado del dia. Debe tener turno ese dia (refinamiento 3). */
  async asignarEncargado(negocioId: string, dto: AsignarEncargadoDto, ctx: CtxTurno) {
    const fecha = fechaSoloDia(dto.fecha);
    const empleado = await this.exigirEmpleado(negocioId, dto.empleadoId);
    const sucursalId = await this.resolverSucursalDelTurno(negocioId, dto.empleadoId, ctx, dto.sucursalId);

    const turnoEseDia = await this.prisma.turno.findFirst({
      where: { negocioId, empleadoId: dto.empleadoId, fecha, sucursalId },
      select: { id: true, tipoTurno: true },
    });
    if (!turnoEseDia) {
      throw new BadRequestException('Ese empleado no tiene turno en esa sucursal ese dia');
    }

    const encargado = await this.prisma.encargadoDia.upsert({
      where: { negocioId_sucursalId_fecha: { negocioId, sucursalId, fecha } },
      update: { empleadoId: dto.empleadoId },
      create: { negocioId, sucursalId, empleadoId: dto.empleadoId, fecha },
      include: { empleado: { select: { id: true, nombre: true } } },
    });

    await this.invalidarSemana(negocioId, fecha, sucursalId);
    await this.invalidarEncargado(negocioId, dto.fecha, sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.encargado_asignado', empleadoId: ctx.empleadoId,
      detalle: { fecha: dto.fecha, empleado: empleado.nombre, sucursalId }, ip: ctx.ip,
    });
    return encargado;
  }

  async eliminarEncargado(negocioId: string, fecha: string, sucursalIdDto: string | undefined, ctx: CtxTurno) {
    const sucursalId = sucursalIdDto ?? ctx.sucursalId;
    if (!sucursalId) throw new BadRequestException('Falta la sucursal');
    const r = await this.prisma.encargadoDia.deleteMany({
      where: { negocioId, sucursalId, fecha: fechaSoloDia(fecha) },
    });
    await this.invalidarEncargado(negocioId, fecha, sucursalId);
    await this.invalidarSemana(negocioId, fecha, sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'turno.encargado_eliminado', empleadoId: ctx.empleadoId,
      detalle: { fecha, sucursalId }, ip: ctx.ip,
    });
    return { ok: true, eliminados: r.count };
  }

  /** Encargado del dia (cacheado 1 h). */
  async obtenerEncargado(negocioId: string, sucursalId: string, fecha: string) {
    const clave = CACHE_ENCARGADO(negocioId, sucursalId, fecha);
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) return JSON.parse(cacheado);

    const enc = await this.prisma.encargadoDia.findUnique({
      where: { negocioId_sucursalId_fecha: { negocioId, sucursalId, fecha: fechaSoloDia(fecha) } },
      include: { empleado: { select: { id: true, nombre: true, rol: true } } },
    });
    const respuesta = enc
      ? { empleadoId: enc.empleadoId, nombre: enc.empleado.nombre, rol: enc.empleado.rol, fecha }
      : null;
    await this.redis.set(clave, JSON.stringify(respuesta), TTL_ENCARGADO).catch(() => undefined);
    return respuesta;
  }

  /**
   * Transicion de encargado (medianoche): crea EncargadoDia del dia nuevo en
   * cada sucursal que tenga un turno con tipoTurno=ENCARGADO. Idempotente
   * (upsert) por el unique [negocioId, sucursalId, fecha].
   */
  async transicionEncargado(fecha = hoy()) {
    const dia = fechaSoloDia(fecha);
    const turnosEncargado = await this.prisma.turno.findMany({
      where: { fecha: dia, tipoTurno: 'ENCARGADO' },
      select: { negocioId: true, sucursalId: true, empleadoId: true, horaInicio: true },
      orderBy: { horaInicio: 'asc' },
    });

    const creados: string[] = [];
    for (const t of turnosEncargado) {
      const existente = await this.prisma.encargadoDia.findUnique({
        where: { negocioId_sucursalId_fecha: { negocioId: t.negocioId, sucursalId: t.sucursalId, fecha: dia } },
        select: { empleadoId: true },
      });
      if (existente) continue; // ya hay encargado: no se pisa

      await this.prisma.encargadoDia.create({
        data: { negocioId: t.negocioId, sucursalId: t.sucursalId, empleadoId: t.empleadoId, fecha: dia },
      });
      await this.invalidarEncargado(t.negocioId, fecha, t.sucursalId);
      creados.push(`${t.negocioId}:${t.sucursalId}`);
    }
    return { fecha, creados: creados.length, detalles: creados };
  }
}
