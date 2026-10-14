import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { ahoraArgentina } from '../push/disparos.service';
import {
  combinarAtencionYDelivery,
  evaluarHorario,
  normalizarHorarioSemana,
  sumarDiasAr,
  type EstadoHorario,
} from './helpers/horario-negocio';

export type TipoHorario = 'atencion' | 'delivery';

export interface OpcionesEstaAbierto {
  negocioId: string;
  /** `null`/ausente = club (todas las sucursales). */
  sucursalId?: string | null;
  /** `atencion` (default) o `delivery` (chequea ADEMAS el horario de atencion). */
  tipo?: TipoHorario;
  /** Inyectable a proposito: los tests no esperan la hora real. */
  ahora?: Date;
}

interface ConfigHorarios {
  horariosAtencion?: unknown;
  horariosDelivery?: unknown;
}

export interface ExcepcionHorarioInput {
  /** YYYY-MM-DD (hora Argentina). */
  desdeFecha: string;
  /** YYYY-MM-DD inclusive. Default: igual a `desdeFecha`. */
  hastaFecha?: string;
  motivo?: string | null;
  /** `null` = todas las sucursales. */
  sucursalId?: string | null;
}

/**
 * FUENTE UNICA DE VERDAD de "el local esta abierto ahora".
 *
 * Nadie mas compara horas: pedidos (gate), visitas (aviso), push (ventana), la carta/el
 * checkout del cliente y el badge del staff consumen esto (o el mismo JSON + Intl en el
 * navegador, que es una re-evaluacion informativa: el backend sigue siendo el gate).
 *
 * Default = SIEMPRE ABIERTO cuando no hay grilla configurada (`SIN_HORARIOS`): es lo que
 * evita romper a los tenants que hoy no tienen horarios.
 */
@Injectable()
export class HorariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** Estado de atencion y/o delivery AHORA, resolviendo la grilla efectiva (global + sucursal). */
  async estaAbierto(opts: OpcionesEstaAbierto): Promise<EstadoHorario> {
    const { negocioId } = opts;
    const sucursalId = opts.sucursalId ?? undefined;
    const tipo: TipoHorario = opts.tipo ?? 'atencion';
    const ahora = opts.ahora ?? new Date();

    const config = (await this.configuracion.configEfectivaCacheada(negocioId, sucursalId)) as ConfigHorarios;
    const diasCerrados = await this.diasCerrados(negocioId, sucursalId, ahora);

    const atencion = evaluarHorario(normalizarHorarioSemana(config.horariosAtencion), ahora, { diasCerrados });
    if (tipo === 'atencion') return atencion;

    const delivery = evaluarHorario(normalizarHorarioSemana(config.horariosDelivery), ahora, { diasCerrados });
    return combinarAtencionYDelivery(atencion, delivery);
  }

  /** Los dos estados a la vez: lo consume el badge del staff y el resumen publico. */
  async estadoLocal(negocioId: string, sucursalId?: string | null, ahora: Date = new Date()) {
    const [atencion, delivery] = await Promise.all([
      this.estaAbierto({ negocioId, sucursalId, tipo: 'atencion', ahora }),
      this.estaAbierto({ negocioId, sucursalId, tipo: 'delivery', ahora }),
    ]);
    return { atencion, delivery };
  }

  /**
   * Excepciones vigentes/futuras (ventana corta) para que el NAVEGADOR del cliente calcule
   * "abierto" con `Intl` (sin polling contra el backend). Fechas en hora ARGENTINA.
   */
  async proximasExcepciones(negocioId: string, sucursalId?: string | null, ahora: Date = new Date(), dias = 8) {
    const ar = ahoraArgentina(ahora);
    const desdeDate = new Date(`${ar.fecha}T00:00:00.000Z`);
    const hastaDate = new Date(`${sumarDiasAr(ar.fecha, dias)}T00:00:00.000Z`);
    const filas = await this.prisma.excepcionHorario.findMany({
      where: {
        negocioId,
        OR: sucursalId ? [{ sucursalId: null }, { sucursalId }] : [{ sucursalId: null }],
        desdeFecha: { lte: hastaDate },
        hastaFecha: { gte: desdeDate },
      },
      orderBy: { desdeFecha: 'asc' },
    });
    return filas.map((f) => ({
      desdeFecha: f.desdeFecha.toISOString().slice(0, 10),
      hastaFecha: f.hastaFecha.toISOString().slice(0, 10),
      motivo: f.motivo,
    }));
  }

  /**
   * Fechas ARGENTINAS (YYYY-MM-DD) cerradas por excepcion alrededor de `ahora`.
   * Se consulta por rango (indice negocio/sucursal/fecha) y se expande en memoria: la
   * tabla es chica (feriados + cierres) y no se cachea (a diferencia de la grilla, que
   * vive en `ConfiguracionClub`/`ConfiguracionSucursal` detras del cache de Redis).
   */
  async diasCerrados(negocioId: string, sucursalId: string | undefined, ahora: Date): Promise<Set<string>> {
    const ar = ahoraArgentina(ahora);
    const desde = sumarDiasAr(ar.fecha, -1);
    const hasta = sumarDiasAr(ar.fecha, 8);
    const desdeDate = new Date(`${desde}T00:00:00.000Z`);
    const hastaDate = new Date(`${hasta}T00:00:00.000Z`);

    const filas = await this.prisma.excepcionHorario.findMany({
      where: {
        negocioId,
        // La excepcion de sucursal aplica SOLO a esa sucursal; la global (null) a todas.
        OR: sucursalId ? [{ sucursalId: null }, { sucursalId }] : [{ sucursalId: null }],
        desdeFecha: { lte: hastaDate },
        hastaFecha: { gte: desdeDate },
      },
      select: { desdeFecha: true, hastaFecha: true },
    });

    const set = new Set<string>();
    for (const f of filas) {
      const ini = f.desdeFecha.toISOString().slice(0, 10);
      const fin = f.hastaFecha.toISOString().slice(0, 10);
      if (fin < ini) { set.add(ini); continue; }
      // Recorte a la ventana consultada (un cierre largo no expande sin limite).
      let cursor = ini < desde ? desde : ini;
      const tope = fin > hasta ? hasta : fin;
      while (cursor <= tope) {
        set.add(cursor);
        cursor = sumarDiasAr(cursor, 1);
      }
    }
    return set;
  }

  // ==========================================================================
  // EXCEPCIONES (feriados / cierre temporal) — CRUD del admin
  // ==========================================================================
  listarExcepciones(negocioId: string) {
    return this.prisma.excepcionHorario.findMany({
      where: { negocioId },
      orderBy: [{ desdeFecha: 'asc' }],
    });
  }

  async crearExcepcion(negocioId: string, dto: ExcepcionHorarioInput, ctx: { empleadoId?: string; ip?: string }) {
    const desdeFecha = this.aFecha(dto.desdeFecha);
    const hastaFecha = dto.hastaFecha ? this.aFecha(dto.hastaFecha) : desdeFecha;
    if (hastaFecha < desdeFecha) {
      throw new BadRequestException('La fecha de fin no puede ser anterior a la de inicio');
    }
    if (dto.sucursalId) {
      const s = await this.prisma.sucursal.findFirst({
        where: { id: dto.sucursalId, negocioId }, select: { id: true },
      });
      if (!s) throw new NotFoundException('Sucursal no encontrada');
    }

    const creada = await this.prisma.excepcionHorario.create({
      data: {
        negocioId,
        sucursalId: dto.sucursalId ?? null,
        desdeFecha,
        hastaFecha,
        motivo: dto.motivo?.trim() || null,
      },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'horarios.excepcion_creada', empleadoId: ctx.empleadoId,
      detalle: { excepcionId: creada.id, desdeFecha: dto.desdeFecha, hastaFecha: dto.hastaFecha ?? dto.desdeFecha, sucursalId: dto.sucursalId ?? null },
      ip: ctx.ip,
    });
    return creada;
  }

  async eliminarExcepcion(negocioId: string, id: string, ctx: { empleadoId?: string; ip?: string }) {
    const existe = await this.prisma.excepcionHorario.findFirst({
      where: { id, negocioId }, select: { id: true },
    });
    if (!existe) throw new NotFoundException('Excepcion no encontrada');
    await this.prisma.excepcionHorario.delete({ where: { id } });
    await this.auditoria.registrar({
      negocioId, accion: 'horarios.excepcion_eliminada', empleadoId: ctx.empleadoId,
      detalle: { excepcionId: id }, ip: ctx.ip,
    });
    return { ok: true, eliminada: id };
  }

  /** Valida `YYYY-MM-DD` y devuelve la fecha @db.Date (medianoche UTC, como Prisma la guarda). */
  private aFecha(texto: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      throw new BadRequestException(`Fecha invalida: "${texto}" (usar YYYY-MM-DD)`);
    }
    const d = new Date(`${texto}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Fecha invalida: "${texto}"`);
    return d;
  }
}
