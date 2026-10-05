import { Injectable, NotFoundException } from '@nestjs/common';
import { ModoClientes, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { getPagination, paginar } from '../common/utils/pagination.util';
import { enmascararTelefono, normalizarTelefonoE164 } from '../common/utils/phone.util';
import { esRolPrivilegiado } from './dto/cliente-response.dto';
import type { ClienteResponseStaff, TarjetaSucursalResponse } from './dto/cliente-response.dto';
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

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly segmentos: SegmentosService,
    private readonly resolver: SucursalResolverService,
  ) {}

  /**
   * Refinamiento 2: formato { data, total, page, pageSize }.
   * Filtrado de campos por rol: admin ve todo; staff solo lo necesario para
   * verificar la tarjeta, con el telefono enmascarado.
   */
  async listar(negocioId: string, filtros: FiltrarClientesDto, ctx: AuthCtx) {
    const { page, pageSize, skip, take } = getPagination(filtros);
    const privilegiado = esRolPrivilegiado(ctx.rol);

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
    if (privilegiado && filtros.sucursalId) {
      where.tarjetas = { some: { sucursalId: filtros.sucursalId } };
    }

    // Refinamiento 5: empleado comun solo ve su sucursal (si el negocio es POR_SUCURSAL)
    let porSucursal = false;
    if (!privilegiado) {
      const negocio = await this.prisma.negocio.findUnique({
        where: { id: negocioId }, select: { modoClientes: true },
      });
      porSucursal = negocio?.modoClientes === ModoClientes.POR_SUCURSAL;
      if (porSucursal) {
        where.tarjetas = { some: { sucursalId: ctx.sucursalId ?? '__sin_sucursal__' } };
      }
    }

    // Proyeccion: el staff NO recibe email, notasInternas ni fechaNacimiento.
    const selectAdmin = {
      id: true, nombre: true, telefono: true, email: true, etiqueta: true,
      sellosActuales: true, puntosActuales: true, totalVisitas: true,
      premiosCanjeados: true, ultimaVisita: true, creadoEn: true,
      notasInternas: true, fechaNacimiento: true, aceptaNotificaciones: true,
    } satisfies Prisma.ClienteSelect;

    const selectStaff = {
      id: true, nombre: true, telefono: true, etiqueta: true,
      sellosActuales: true, puntosActuales: true, ultimaVisita: true,
      ...(porSucursal
        ? { tarjetas: { include: { sucursal: { select: { id: true, nombre: true, slug: true, esPrincipal: true } } } } }
        : {}),
    } satisfies Prisma.ClienteSelect;

    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        orderBy: { ultimaVisita: 'desc' },
        skip,
        take,
        select: privilegiado ? selectAdmin : selectStaff,
      }),
      this.prisma.cliente.count({ where }),
    ]);

    const dataFinal = privilegiado ? data : (data as Record<string, unknown>[]).map((c) => this.aStaff(c));
    return paginar(dataFinal, total, page, pageSize);
  }

  /**
   * Refinamiento 7: tarjetas por sucursal (si POR_SUCURSAL) + historial paginado.
   * ADMIN: cliente completo + historial. STAFF: solo la tarjeta para verificar
   * en el mostrador, sin email, sin notasInternas y sin historial.
   */
  async obtener(
    negocioId: string,
    clienteId: string,
    visitasPage: number,
    visitasPageSize: number,
    rol: string,
  ) {
    const privilegiado = esRolPrivilegiado(rol);

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

    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { sellosParaPremio: true },
    });
    const progreso = this.segmentos.progreso(cliente.sellosActuales, config?.sellosParaPremio ?? 10);

    // --- STAFF: vista reducida, sin historial ni datos sensibles ---
    if (!privilegiado) {
      return { cliente: this.aStaff({ ...cliente, tarjetas }), progreso };
    }

    // --- ADMIN: vista completa ---
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

    // eliminadoEn siempre es null aca (el where ya lo filtra): no ensuciar la respuesta
    const { eliminadoEn: _omitido, ...clientePublico } = cliente;

    return {
      cliente: {
        ...clientePublico,
        sellosActuales: cliente.sellosActuales,
        puntosActuales: cliente.puntosActuales,
        totalVisitas: cliente.totalVisitas,
      },
      progreso,
      tarjetasPorSucursal: tarjetas,
      historialVisitas: { data: visitas, total: totalVisitas, page: visitasPage, pageSize: visitasPageSize },
    };
  }

  /** Proyeccion reducida para staff: telefono enmascarado y sin campos sensibles. */
  private aStaff(cliente: Record<string, any>): ClienteResponseStaff {
    const anidadas = Array.isArray(cliente.tarjetas) ? cliente.tarjetas : undefined;
    return {
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: enmascararTelefono(String(cliente.telefono ?? '')),
      etiqueta: cliente.etiqueta,
      sellosActuales: cliente.sellosActuales,
      puntosActuales: cliente.puntosActuales,
      ultimaVisita: cliente.ultimaVisita ?? null,
      ...(anidadas ? { tarjetas: this.mapTarjetas(anidadas) } : {}),
    };
  }

  private mapTarjetas(tarjetas: Record<string, any>[]): TarjetaSucursalResponse[] {
    return tarjetas.map((t) => ({
      sucursalId: t.sucursalId,
      sucursalNombre: t.sucursal?.nombre,
      sucursalSlug: t.sucursal?.slug,
      esPrincipal: t.sucursal?.esPrincipal,
      sellosActuales: t.sellosActuales,
      puntosActuales: t.puntosActuales,
      totalVisitas: t.totalVisitas,
    }));
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
