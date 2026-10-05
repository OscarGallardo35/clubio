import { Injectable, NotFoundException } from '@nestjs/common';
import { ModoClientes, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { getPagination, paginar } from '../common/utils/pagination.util';
import { normalizarTelefonoE164 } from '../common/utils/phone.util';
import { SegmentosService } from './segmentos.service';
import type { CrearClienteManualDto } from './dto/crear-cliente-manual.dto';
import type { ActualizarClienteDto } from './dto/actualizar-cliente.dto';
import type { FiltrarClientesDto } from './dto/filtrar-clientes.dto';
import type { RegalarSelloDto } from './dto/regalar-sello.dto';

/** Contexto del usuario autenticado que arma el guard. */
export interface AuthCtx {
  empleadoId: string;
  negocioId: string;
  rol: string;
  sucursalId?: string;
  ip?: string;
}

/** Roles con visibilidad total del negocio. */
const ROLES_PRIVILEGIADOS = ['DUENO', 'ENCARGADO'];

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly segmentos: SegmentosService,
    private readonly resolver: SucursalResolverService,
  ) {}

  /** Refinamiento 2: formato { data, total, page, pageSize }. */
  async listar(negocioId: string, filtros: FiltrarClientesDto, ctx: AuthCtx) {
    const { page, pageSize, skip, take } = getPagination(filtros);

    const where: Prisma.ClienteWhereInput = {
      negocioId,
      eliminadoEn: null, // Refinamiento 3: excluye soft-deleted
    };
    if (filtros.etiqueta) where.etiqueta = filtros.etiqueta;
    if (filtros.search) {
      where.OR = [
        { nombre: { contains: filtros.search, mode: 'insensitive' } },
        { telefono: { contains: filtros.search } },
      ];
    }

    // Sucursal pedida explicitamente (si es privilegiado)
    const esPrivilegiado = ROLES_PRIVILEGIADOS.includes(ctx.rol);
    if (esPrivilegiado && filtros.sucursalId) {
      where.tarjetas = { some: { sucursalId: filtros.sucursalId } };
    }

    // Refinamiento 5: empleado comun solo ve su sucursal (si el negocio es POR_SUCURSAL)
    if (!esPrivilegiado) {
      const negocio = await this.prisma.negocio.findUnique({
        where: { id: negocioId }, select: { modoClientes: true },
      });
      if (negocio?.modoClientes === ModoClientes.POR_SUCURSAL) {
        where.tarjetas = { some: { sucursalId: ctx.sucursalId ?? '__sin_sucursal__' } };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        orderBy: { ultimaVisita: 'desc' },
        skip,
        take,
        select: {
          id: true, nombre: true, telefono: true, email: true, etiqueta: true,
          sellosActuales: true, puntosActuales: true, totalVisitas: true,
          premiosCanjeados: true, ultimaVisita: true, creadoEn: true,
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);

    return paginar(data, total, page, pageSize);
  }

  /** Refinamiento 7: tarjetas por sucursal (si POR_SUCURSAL) + historial paginado. */
  async obtener(negocioId: string, clienteId: string, visitasPage = 1, visitasPageSize = 10) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, negocioId, eliminadoEn: null },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { modoClientes: true },
    });

    const tarjetas = negocio?.modoClientes === ModoClientes.POR_SUCURSAL
      ? await this.prisma.tarjetaClienteSucursal.findMany({
          where: { clienteId },
          include: { sucursal: { select: { id: true, nombre: true, slug: true, esPrincipal: true } } },
        })
      : [];

    const [visitas, totalVisitas] = await Promise.all([
      this.prisma.visita.findMany({
        where: { negocioId, clienteId },
        orderBy: { aprobadoEn: 'desc' },
        skip: (visitasPage - 1) * visitasPageSize,
        take: visitasPageSize,
        include: { sucursal: { select: { id: true, nombre: true } } },
      }),
      this.prisma.visita.count({ where: { negocioId, clienteId } }),
    ]);

    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { sellosParaPremio: true },
    });

    return {
      cliente: {
        ...cliente,
        sellosActuales: cliente.sellosActuales,
        puntosActuales: cliente.puntosActuales,
        totalVisitas: cliente.totalVisitas,
      },
      progreso: this.segmentos.progreso(cliente.sellosActuales, config?.sellosParaPremio ?? 10),
      tarjetasPorSucursal: tarjetas,
      historialVisitas: { data: visitas, total: totalVisitas, page: visitasPage, pageSize: visitasPageSize },
    };
  }

  async crearManual(negocioId: string, dto: CrearClienteManualDto, ctx: AuthCtx) {
    const telefono = normalizarTelefonoE164(dto.telefono);

    const existente = await this.prisma.cliente.findUnique({
      where: { negocioId_telefono: { negocioId, telefono } },
      select: { id: true, eliminadoEn: true },
    });

    // Si existia soft-deleted, se revive.
    const cliente = existente
      ? await this.prisma.cliente.update({
          where: { id: existente.id },
          data: { nombre: dto.nombre, email: dto.email ?? null, notasInternas: dto.notasInternas ?? null, eliminadoEn: null, aceptaNotificaciones: dto.aceptaNotificaciones ?? false },
        })
      : await this.prisma.cliente.create({
          data: {
            negocioId, nombre: dto.nombre, telefono,
            email: dto.email ?? null, notasInternas: dto.notasInternas ?? null,
            aceptaNotificaciones: dto.aceptaNotificaciones ?? false,
          },
        });

    // Crea la tarjeta de la sucursal resuelta (multi-sucursal desde el inicio)
    const sucursal = await this.resolver.resolverSucursal(negocioId, {
      sucursalId: ctx.sucursalId, empleadoId: ctx.empleadoId,
    });
    await this.prisma.tarjetaClienteSucursal.upsert({
      where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id as string } },
      update: {},
      create: { clienteId: cliente.id, sucursalId: sucursal.id as string },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'cliente.creado', empleadoId: ctx.empleadoId,
      clienteId: cliente.id, detalle: { telefono, revivido: !!existente }, ip: ctx.ip,
    });
    return cliente;
  }

  async actualizar(negocioId: string, clienteId: string, dto: ActualizarClienteDto, ctx: AuthCtx) {
    await this.exigirCliente(negocioId, clienteId);
    const cliente = await this.prisma.cliente.update({
      where: { id: clienteId }, data: { ...dto },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'cliente.actualizado', empleadoId: ctx.empleadoId,
      clienteId, detalle: { campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return cliente;
  }

  /** Refinamiento 3: soft delete. */
  async eliminar(negocioId: string, clienteId: string, ctx: AuthCtx) {
    await this.exigirCliente(negocioId, clienteId);
    const cliente = await this.prisma.cliente.update({
      where: { id: clienteId },
      data: { eliminadoEn: new Date() },
      select: { id: true, nombre: true, eliminadoEn: true },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'cliente.eliminado', empleadoId: ctx.empleadoId, clienteId, ip: ctx.ip,
    });
    return cliente;
  }

  /** Regalo manual de sellos/puntos (solo DUENO). */
  async regalarSello(negocioId: string, clienteId: string, dto: RegalarSelloDto, ctx: AuthCtx) {
    const cliente = await this.exigirCliente(negocioId, clienteId);
    const sellos = dto.sellos ?? 1;
    const puntos = dto.puntos ?? 0;

    const sucursal = await this.resolver.resolverSucursal(negocioId, {
      sucursalId: ctx.sucursalId, empleadoId: ctx.empleadoId,
    });

    const [visita, actualizado] = await this.prisma.$transaction([
      this.prisma.visita.create({
        data: {
          negocioId, sucursalId: sucursal.id as string, clienteId, empleadoId: ctx.empleadoId,
          tipo: 'REGALO_MANUAL', sellosOtorgados: sellos, puntosOtorgados: puntos,
          metodo: 'MANUAL', notas: dto.motivo ?? 'Regalo manual',
        },
      }),
      this.prisma.cliente.update({
        where: { id: clienteId },
        data: {
          sellosActuales: { increment: sellos },
          puntosActuales: { increment: puntos },
          etiqueta: this.segmentos.calcularEtiqueta(cliente.totalVisitas, cliente.ultimaVisita),
        },
      }),
    ]);

    await this.auditoria.registrar({
      negocioId, accion: 'cliente.sello_regalado', empleadoId: ctx.empleadoId, clienteId,
      detalle: { sellos, puntos, motivo: dto.motivo ?? null }, ip: ctx.ip,
    });
    return { visita, cliente: actualizado };
  }

  /** Historial de visitas paginado de un cliente. */
  async visitas(negocioId: string, clienteId: string, page: number, pageSize: number) {
    await this.exigirCliente(negocioId, clienteId);
    const where = { negocioId, clienteId };
    const [data, total] = await Promise.all([
      this.prisma.visita.findMany({
        where, orderBy: { aprobadoEn: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
        include: { sucursal: { select: { id: true, nombre: true } } },
      }),
      this.prisma.visita.count({ where }),
    ]);
    return paginar(data, total, page, pageSize);
  }

  private async exigirCliente(negocioId: string, clienteId: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, negocioId, eliminadoEn: null },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    return cliente;
  }
}
