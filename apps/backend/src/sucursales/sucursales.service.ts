
import {
  BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import { EstadoPedido, Prisma, RolEmpleado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from './sucursal-resolver.service';
import { LimitesService } from '../planes/limites.service';
import type { CrearSucursalDto } from './dto/crear-sucursal.dto';
import type { ActualizarSucursalDto } from './dto/actualizar-sucursal.dto';
import type { FiltrarSucursalesDto } from './dto/filtrar-sucursales.dto';
import type { ResumenSucursal, SucursalDetalle } from './interfaces/resumen-sucursal.interface';

export interface CtxSucursal {
  empleadoId: string;
  rol: RolEmpleado;
  sucursalId?: string | null;
  accesoMultiSucursal?: boolean;
  ip?: string;
}

/** Pedidos que todavia estan "en curso" (no cerrados ni cancelados). */
const PEDIDOS_ACTIVOS: EstadoPedido[] = ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO'];

@Injectable()
export class SucursalesService {
  private readonly logger = new Logger('Sucursales');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
    private readonly limites: LimitesService,
  ) {}

  private rangoMes(ahora = new Date()): { gte: Date; lt: Date } {
    const gte = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const lt = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
    return { gte, lt };
  }

  // ------------------------------------------------------------------ CRUD ----

  async listar(negocioId: string, filtros: FiltrarSucursalesDto = {}): Promise<{ data: ResumenSucursal[]; total: number }> {
    const where: Prisma.SucursalWhereInput = { negocioId };
    if (filtros.activa !== undefined) where.activa = filtros.activa;
    if (filtros.esPrincipal !== undefined) where.esPrincipal = filtros.esPrincipal;
    if (filtros.busqueda) {
      where.OR = [
        { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
        { slug: { contains: filtros.busqueda, mode: 'insensitive' } },
      ];
    }

    const sucursales = await this.prisma.sucursal.findMany({
      where,
      orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
    });

    const mes = this.rangoMes();
    const data = await Promise.all(sucursales.map(async (s) => {
      const [empleadosActivos, clientesRegistrados, pedidosDelMes, visitasDelMes, cfg] = await Promise.all([
        this.prisma.empleado.count({ where: { sucursalId: s.id, activo: true, eliminadoEn: null } }),
        this.prisma.tarjetaClienteSucursal.count({ where: { sucursalId: s.id } }),
        this.prisma.pedido.count({ where: { sucursalId: s.id, creadoEn: mes } }),
        this.prisma.visita.count({ where: { sucursalId: s.id, aprobadoEn: mes } }),
        this.prisma.configuracionSucursal.findUnique({ where: { sucursalId: s.id }, select: { id: true } }),
      ]);
      return {
        id: s.id, nombre: s.nombre, slug: s.slug, direccion: s.direccion,
        telefono: s.telefono, numeroAtendiente: s.numeroAtendiente,
        activa: s.activa, esPrincipal: s.esPrincipal,
        colorPrimario: s.colorPrimario, colorSecundario: s.colorSecundario,
        creadoEn: s.creadoEn,
        empleadosActivos, clientesRegistrados, pedidosDelMes, visitasDelMes,
        tieneConfiguracionOverride: cfg !== null,
      } as ResumenSucursal;
    }));

    const orden = filtros.orden ?? 'asc';
    const por = filtros.ordenarPor;
    if (por) {
      data.sort((a, b) => {
        const va = (a as unknown as Record<string, number>)[por] ?? 0;
        const vb = (b as unknown as Record<string, number>)[por] ?? 0;
        return orden === 'desc' ? vb - va : va - vb;
      });
    }
    return { data, total: data.length };
  }

  async obtenerPorId(negocioId: string, id: string): Promise<SucursalDetalle> {
    const s = await this.prisma.sucursal.findFirst({ where: { id, negocioId } });
    if (!s) throw new NotFoundException('Sucursal no encontrada');

    const mes = this.rangoMes();
    const [cfg, empleados, clientesRegistrados, pedidosDelMes, visitasDelMes, pedidosActivos] = await Promise.all([
      this.prisma.configuracionSucursal.findUnique({ where: { sucursalId: id } }),
      this.prisma.empleado.findMany({
        where: { sucursalId: id, eliminadoEn: null },
        select: { id: true, nombre: true, rol: true, activo: true },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.tarjetaClienteSucursal.count({ where: { sucursalId: id } }),
      this.prisma.pedido.count({ where: { sucursalId: id, creadoEn: mes } }),
      this.prisma.visita.count({ where: { sucursalId: id, aprobadoEn: mes } }),
      this.prisma.pedido.count({ where: { sucursalId: id, estado: { in: PEDIDOS_ACTIVOS } } }),
    ]);

    return {
      ...s,
      configuracion: cfg,
      empleados,
      estadisticas: {
        empleadosActivos: empleados.filter((e) => e.activo).length,
        clientesRegistrados, pedidosDelMes, visitasDelMes, pedidosActivos,
      },
    };
  }

  async crear(negocioId: string, dto: CrearSucursalDto, ctx: CtxSucursal) {
    // Limite ANTES de escribir.
    const limite = await this.limites.exigirLimite(negocioId, 'SUCURSALES');

    const dup = await this.prisma.sucursal.findFirst({
      where: { negocioId, slug: dto.slug }, select: { id: true },
    });
    if (dup) throw new ConflictException(`Ya existe una sucursal con el slug "${dto.slug}"`);

    // Primera del negocio -> principal SIEMPRE. Si ya hay principal, la nueva NO lo es.
    const total = await this.prisma.sucursal.count({ where: { negocioId } });
    const esPrimera = total === 0;
    const esPrincipal = esPrimera ? true : false;

    const sucursal = await this.prisma.sucursal.create({
      data: {
        negocioId, nombre: dto.nombre, slug: dto.slug,
        direccion: dto.direccion ?? null, telefono: dto.telefono ?? null,
        numeroAtendiente: dto.numeroAtendiente ?? null,
        colorPrimario: dto.colorPrimario ?? null, colorSecundario: dto.colorSecundario ?? null,
        esPrincipal,
      },
    });

    await this.limites.incrementarUso(negocioId, 'SUCURSALES');
    await this.resolver.invalidar(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.creada', empleadoId: ctx.empleadoId,
      detalle: {
        sucursalId: sucursal.id, slug: sucursal.slug, nombre: sucursal.nombre,
        esPrincipal, automatica: esPrimera, solicitoPrincipal: dto.esPrincipal ?? false,
        limiteBase: limite.limiteBase, estado: limite.estado,
      },
      ip: ctx.ip,
    });
    if (esPrimera && dto.esPrincipal === false) {
      this.logger.log(`La primera sucursal de ${negocioId} se marco principal aunque el DTO decia lo contrario`);
    }
    return sucursal;
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarSucursalDto, ctx: CtxSucursal) {
    await this.exigirSucursal(negocioId, id);

    // No se puede desactivar la principal por esta via (usa eliminar, que tambien la bloquea).
    if (dto.activa === false) {
      const s = await this.prisma.sucursal.findUnique({ where: { id }, select: { esPrincipal: true } });
      if (s?.esPrincipal) {
        throw new BadRequestException('La sucursal principal no se puede desactivar');
      }
    }

    const sucursal = await this.prisma.sucursal.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.direccion !== undefined ? { direccion: dto.direccion } : {}),
        ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
        ...(dto.numeroAtendiente !== undefined ? { numeroAtendiente: dto.numeroAtendiente } : {}),
        ...(dto.colorPrimario !== undefined ? { colorPrimario: dto.colorPrimario } : {}),
        ...(dto.colorSecundario !== undefined ? { colorSecundario: dto.colorSecundario } : {}),
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
      },
    });

    await this.resolver.invalidar(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.actualizada', empleadoId: ctx.empleadoId,
      detalle: { sucursalId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return sucursal;
  }

  /** Cambia cual es la principal (la anterior deja de serlo). */
  async marcarPrincipal(negocioId: string, id: string, ctx: CtxSucursal) {
    const s = await this.exigirSucursal(negocioId, id);
    if (!s.activa) throw new BadRequestException('No se puede marcar como principal una sucursal inactiva');
    if (s.esPrincipal) return s;

    const anterior = await this.prisma.sucursal.findFirst({
      where: { negocioId, esPrincipal: true }, select: { id: true, nombre: true },
    });

    const [, nueva] = await this.prisma.$transaction([
      this.prisma.sucursal.updateMany({ where: { negocioId, esPrincipal: true }, data: { esPrincipal: false } }),
      this.prisma.sucursal.update({ where: { id }, data: { esPrincipal: true } }),
    ]);

    await this.resolver.invalidar(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.principal_cambiada', empleadoId: ctx.empleadoId,
      detalle: { anteriorId: anterior?.id ?? null, anteriorNombre: anterior?.nombre ?? null, nuevaId: id }, ip: ctx.ip,
    });
    return nueva;
  }

  /**
   * Soft delete (activa = false).
   *
   * La principal NO se elimina. Si tiene empleados activos o pedidos activos -> 409,
   * salvo force=true: reasigna los empleados a la principal y cancela los pedidos.
   */
  async eliminar(negocioId: string, id: string, ctx: CtxSucursal, force = false) {
    const s = await this.exigirSucursal(negocioId, id);
    if (s.esPrincipal) {
      throw new BadRequestException('La sucursal principal no se puede eliminar');
    }

    const principal = await this.prisma.sucursal.findFirst({
      where: { negocioId, esPrincipal: true }, select: { id: true, nombre: true },
    });
    if (!principal) {
      // Estado inconsistente: el cron diario lo repara con reconciliarPrincipales().
      throw new InternalServerErrorException(
        `El negocio no tiene sucursal principal configurada (revisar ${negocioId})`,
      );
    }

    const [empleadosActivos, pedidosActivos] = await Promise.all([
      this.prisma.empleado.findMany({
        where: { sucursalId: id, activo: true, eliminadoEn: null },
        select: { id: true, nombre: true, rol: true },
      }),
      this.prisma.pedido.count({ where: { sucursalId: id, estado: { in: PEDIDOS_ACTIVOS } } }),
    ]);

    if ((empleadosActivos.length || pedidosActivos) && !force) {
      throw new ConflictException({
        message: `La sucursal tiene ${empleadosActivos.length} empleado(s) activo(s) y ${pedidosActivos} pedido(s) en curso. Repeti con force=true para reasignar y cancelar.`,
        empleadosActivos: empleadosActivos.map((e) => ({ id: e.id, nombre: e.nombre, rol: e.rol })),
        pedidosActivos,
      });
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      let reasignados = 0, cancelados = 0;
      if (force) {
        if (empleadosActivos.length) {
          const r = await tx.empleado.updateMany({
            where: { id: { in: empleadosActivos.map((e) => e.id) } },
            data: { sucursalId: principal.id },
          });
          reasignados = r.count;
        }
        if (pedidosActivos) {
          const r = await tx.pedido.updateMany({
            where: { sucursalId: id, estado: { in: PEDIDOS_ACTIVOS } },
            data: { estado: EstadoPedido.CANCELADO },
          });
          cancelados = r.count;
        }
      }
      const borrada = await tx.sucursal.update({ where: { id }, data: { activa: false } });
      return { borrada, reasignados, cancelados };
    });

    await this.limites.decrementarUso(negocioId, 'SUCURSALES');
    await this.resolver.invalidar(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.eliminada', empleadoId: ctx.empleadoId,
      detalle: {
        sucursalId: id, slug: s.slug, force,
        empleadosReasignados: resultado.reasignados, empleadosA: principal.nombre,
        pedidosCancelados: resultado.cancelados,
      },
      ip: ctx.ip,
    });
    return {
      ok: true, sucursalId: id,
      empleadosReasignados: resultado.reasignados,
      pedidosCancelados: resultado.cancelados,
    };
  }

  async exigirSucursal(negocioId: string, id: string) {
    const s = await this.prisma.sucursal.findFirst({ where: { id, negocioId } });
    if (!s) throw new NotFoundException('Sucursal no encontrada');
    return s;
  }

  // -------------------------------------------------- mis-sucursales (#4.7) ----

  /**
   * Sucursales visibles para el usuario logueado:
   *   DUENO                                  -> todas las ACTIVAS
   *   ENCARGADO con accesoMultiSucursal=true -> todas las ACTIVAS
   *   ENCARGADO sin acceso / resto de roles  -> solo la suya
   */
  async misSucursales(negocioId: string, ctx: CtxSucursal) {
    const verTodas = ctx.rol === RolEmpleado.DUENO
      || (ctx.rol === RolEmpleado.ENCARGADO && ctx.accesoMultiSucursal === true);

    const sucursales = await this.prisma.sucursal.findMany({
      where: {
        negocioId,
        activa: true,
        ...(verTodas ? {} : { id: ctx.sucursalId ?? '__sin_sucursal__' }),
      },
      select: {
        id: true, nombre: true, slug: true, direccion: true, telefono: true,
        numeroAtendiente: true, esPrincipal: true, colorPrimario: true, colorSecundario: true,
      },
      orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
    });

    return {
      data: sucursales,
      total: sucursales.length,
      alcance: verTodas ? 'TODAS' : 'PROPIA',
      rol: ctx.rol,
    };
  }

  /** Listado publico (PWA Cliente): solo activas, sin metricas ni datos internos. */
  async listarPublicoPorSlug(slug: string) {
    const neg = await this.prisma.negocio.findFirst({
      where: { slug, activo: true }, select: { id: true },
    });
    if (!neg) throw new NotFoundException('Negocio no encontrado');
    const data = await this.prisma.sucursal.findMany({
      where: { negocioId: neg.id, activa: true },
      select: {
        id: true, nombre: true, slug: true, direccion: true, telefono: true,
        numeroAtendiente: true, esPrincipal: true, colorPrimario: true, colorSecundario: true,
      },
      orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
    });
    return { data, total: data.length };
  }

  /** Para el #2.10 verificacion: deja el negocio con exactamente 1 principal. */
  async reconciliarPrincipales(negocioId: string) {
    const sucursales = await this.prisma.sucursal.findMany({
      where: { negocioId }, orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
      select: { id: true, esPrincipal: true, activa: true },
    });
    if (!sucursales.length) return { corregido: false, motivo: 'sin sucursales' };

    const activas = sucursales.filter((s) => s.activa);
    const principales = activas.filter((s) => s.esPrincipal);

    if (principales.length === 1) return { corregido: false, motivo: 'ok' };

    // Sin principal, o con mas de una: se deja la primera activa como unica principal.
    const elegida = principales[0] ?? activas[0];
    if (!elegida) return { corregido: false, motivo: 'sin sucursales activas' };

    await this.prisma.$transaction([
      this.prisma.sucursal.updateMany({ where: { negocioId }, data: { esPrincipal: false } }),
      this.prisma.sucursal.update({ where: { id: elegida.id }, data: { esPrincipal: true } }),
    ]);
    await this.resolver.invalidar(negocioId);
    return {
      corregido: true,
      motivo: principales.length > 1 ? `habia ${principales.length} principales` : 'no habia principal',
      nuevaPrincipalId: elegida.id,
    };
  }
}
