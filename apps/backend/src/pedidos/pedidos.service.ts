
import {
  BadRequestException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PushService } from '../push/push.service';
import { normalizarTelefonoE164 } from '../common/utils/phone.util';
import { getPagination, paginar } from '../common/utils/pagination.util';
import { requireEnv } from '../common/utils/env.util';
import { PedidosGateway } from './pedidos.gateway';
import { calcularTotales } from './helpers/calcular-totales';
import { construirUrlCorta, generarLinkToken, calcularExpiracion, linkVencido } from './helpers/generar-link-corto';
import { generarMensajeWhatsApp } from './helpers/generar-mensaje-whatsapp';
import {
  ESTADOS_ACTIVOS, MENSAJE_POR_ESTADO, TITULO_POR_ESTADO, transicionValidaParaTipo,
} from './helpers/transiciones-estado';
import type { ItemInput, PedidoCtx } from './interfaces/pedido-item.interface';
import type { CrearPedidoDto } from './dto/crear-pedido.dto';
import type { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto';
import type { FiltrarPedidosDto } from './dto/filtrar-pedidos.dto';

const MAX_REINTENTOS_LINK = 3;

@Injectable()
export class PedidosService {
  private readonly logger = new Logger('Pedidos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
    private readonly configuracion: ConfiguracionService,
    private readonly push: PushService,
    private readonly gateway: PedidosGateway,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Refinamiento 4: POST /pedidos es publico, pero si viene un JWT de cliente
   * valido se vincula el pedido. Token invalido o de otro tipo -> se trata como
   * guest (no se rechaza: el pedido igual se puede hacer).
   */
  async identificarClienteOpcional(authHeader?: string): Promise<string | null> {
    const [scheme, token] = String(authHeader ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    try {
      const payload = this.jwt.verify(token, {
        secret: requireEnv('JWT_CLIENTE_SECRET', 'dev-cliente-solo-desarrollo'),
      }) as { sub?: string; tipo?: string; negocioId?: string };
      if (payload.tipo !== 'cliente' || !payload.sub) return null;

      const cliente = await this.prisma.cliente.findFirst({
        where: { id: payload.sub, eliminadoEn: null },
        select: { id: true },
      });
      return cliente?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Refinamiento (Lote 6): resuelve la sucursal del pedido.
   * Prioridad: dto.sucursalId > dto.sucursalSlug > tarjeta del cliente
   * (si el negocio es POR_SUCURSAL y tiene UNA sola) > sucursal principal.
   */
  private async resolverSucursalPedido(
    negocioId: string,
    dto: { sucursalId?: string; sucursalSlug?: string },
    clienteId?: string | null,
  ) {
    let sucursalId = dto.sucursalId ?? null;

    if (!sucursalId && !dto.sucursalSlug && clienteId) {
      const negocio = await this.prisma.negocio.findUnique({
        where: { id: negocioId }, select: { modoClientes: true },
      });
      if (negocio?.modoClientes === 'POR_SUCURSAL') {
        const tarjetas = await this.prisma.tarjetaClienteSucursal.findMany({
          where: { clienteId }, select: { sucursalId: true },
        });
        if (tarjetas.length === 1) sucursalId = tarjetas[0].sucursalId;
      }
    }

    return this.resolver.resolverSucursal(negocioId, {
      sucursalId,
      sucursalSlug: dto.sucursalSlug ?? null,
    });
  }

  /** Resuelve el negocio desde el slug del tenant (rutas publicas). */
  async negocioPorSlug(slug?: string | null): Promise<string> {
    if (!slug) throw new NotFoundException('Falta el tenant (X-Tenant-Slug) para esta operacion');
    const negocio = await this.prisma.negocio.findUnique({
      where: { slug: String(slug).toLowerCase() }, select: { id: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    return negocio.id;
  }

  async crearPedido(negocioId: string, dto: CrearPedidoDto, clienteId?: string | null) {
    const sucursal = await this.resolverSucursalPedido(negocioId, dto, clienteId);
    const sucursalId = sucursal.id as string;

    // Refinamientos 1 y 2: config EFECTIVA (global + override de la sucursal)
    const config = await this.configuracion.configEfectiva(negocioId, sucursalId) as unknown as {
      menuActivo: boolean;
      tiposPedidoHabilitados: string[];
      modosPagoHabilitados: string[];
      costoEnvio: unknown;
      pedidoMinimoDelivery: unknown;
    };

    if (config.menuActivo !== true) {
      throw new BadRequestException('El menu digital no esta activo en esta sucursal');
    }
    if (!config.tiposPedidoHabilitados?.includes(dto.tipo)) {
      throw new BadRequestException(
        `Tipo de pedido no habilitado: ${dto.tipo}. Habilitados: ${config.tiposPedidoHabilitados?.join(', ') || 'ninguno'}`,
      );
    }
    if (!config.modosPagoHabilitados?.includes(dto.modoPago)) {
      throw new BadRequestException(
        `Modo de pago no habilitado: ${dto.modoPago}. Habilitados: ${config.modosPagoHabilitados?.join(', ') || 'ninguno'}`,
      );
    }

    // Reglas por tipo
    if (dto.tipo === 'DELIVERY') {
      if (config.costoEnvio === null || config.costoEnvio === undefined) {
        throw new BadRequestException('Delivery no configurado: falta el costo de envio');
      }
      if (!dto.direccion?.trim()) {
        throw new BadRequestException('El pedido de delivery necesita una direccion');
      }
    }
    if (dto.tipo === 'MESA' && !dto.mesa?.trim() && !dto.origen?.trim()) {
      throw new BadRequestException('El pedido de mesa necesita el numero de mesa u origen');
    }

    // Refinamiento 3: telefono E.164 (lanza 400 con mensaje claro)
    const telefono = normalizarTelefonoE164(dto.telefono);

    // Refinamiento 6 + recalculo de precios desde la DB + override por sucursal
    const { items, subtotal, costoEnvio, total } = await calcularTotales(
      this.prisma, negocioId, sucursalId, dto.items as ItemInput[], dto.tipo, config,
    );

    // Link corto de 128 bits, con reintento ante colision del unique
    let pedido: Record<string, any> | null = null;
    let linkToken = '';
    for (let intento = 0; intento < MAX_REINTENTOS_LINK && !pedido; intento++) {
      linkToken = generarLinkToken();
      try {
        pedido = await this.prisma.pedido.create({
          data: {
            negocioId, sucursalId,
            clienteId: clienteId ?? null,
            nombreCliente: dto.nombreCliente.trim(),
            telefono,
            direccion: dto.direccion?.trim() ?? null,
            origen: dto.origen?.trim() ?? null,
            mesa: dto.mesa?.trim() ?? null,
            tipo: dto.tipo,
            modoPago: dto.modoPago,
            items: items as unknown as Prisma.InputJsonValue,
            subtotal: new Prisma.Decimal(subtotal),
            costoEnvio: costoEnvio > 0 ? new Prisma.Decimal(costoEnvio) : null,
            total: new Prisma.Decimal(total),
            notas: dto.notas?.trim() ?? null,
            estado: EstadoPedido.PENDIENTE,
            linkToken,
            linkExpiraEn: calcularExpiracion(),
          },
        }) as unknown as Record<string, any>;
      } catch (e) {
        const esColision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!esColision || intento === MAX_REINTENTOS_LINK - 1) throw e;
        this.logger.warn(`Colision de linkToken, reintento ${intento + 2}`);
      }
    }
    if (!pedido) throw new BadRequestException('No se pudo generar el link del pedido');

    const urlCorta = construirUrlCorta(linkToken);
    const mensajeWhatsApp = generarMensajeWhatsApp({
      nombreCliente: pedido.nombreCliente, items, subtotal, costoEnvio, total,
      tipo: dto.tipo, mesa: pedido.mesa, modoPago: dto.modoPago, notas: pedido.notas, urlCorta,
    });

    await this.auditoria.registrar({
      negocioId, accion: 'pedido.creado',
      detalle: { pedidoId: pedido.id, sucursalId, tipo: dto.tipo, total, items: items.length },
    });

    // WebSocket: SOLO la sucursal destino + duenos
    this.gateway.emitirNuevo({
      negocioId, sucursalId, pedidoId: pedido.id, linkToken,
      nombreCliente: pedido.nombreCliente, total, tipo: dto.tipo,
      mesa: pedido.mesa, creadoEn: pedido.creadoEn,
    });

    // Push al staff de esa sucursal (no bloquea: encola)
    await this.push.enviarAEmpleadosDelNegocio(
      negocioId,
      {
        title: 'Nuevo pedido',
        body: `${pedido.nombreCliente}: ${items.length} item(s) - $${total}`,
        url: `/pedidos`,
        tag: 'pedido-nuevo',
      },
      sucursalId,
    ).catch((e) => this.logger.warn(`Push de pedido nuevo fallo: ${(e as Error).message}`));

    return {
      pedidoId: pedido.id,
      linkToken,
      urlCorta,
      mensajeWhatsApp,
      expiraEn: pedido.linkExpiraEn,
      total,
      sucursalId,
    };
  }

  /** GET /pedidos/publico/:linkToken — el token ES la autenticacion. */
  async obtenerPedidoPorLink(negocioId: string, linkToken: string) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { negocioId, linkToken },
      include: {
        sucursal: { select: { id: true, nombre: true, slug: true } },
        cliente: { select: { id: true, nombre: true } },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (linkVencido(pedido.linkExpiraEn)) {
      throw new GoneException('Link expirado. Pedile al cliente que reenvie el pedido.');
    }

    return {
      ...pedido,
      subtotal: Number(pedido.subtotal),
      costoEnvio: pedido.costoEnvio !== null ? Number(pedido.costoEnvio) : null,
      total: Number(pedido.total),
    };
  }

  async listarPedidos(negocioId: string, filtros: FiltrarPedidosDto, ctx: { sucursalId?: string | null; rol?: string }) {
    const { page, pageSize, skip, take } = getPagination(filtros);
    const where: Prisma.PedidoWhereInput = { negocioId };

    const estados = filtros.estado
      ? (filtros.estado.split(',').map((e) => e.trim()).filter(Boolean) as EstadoPedido[])
      : (filtros.incluirCerrados ? undefined : ESTADOS_ACTIVOS);
    if (estados?.length) where.estado = { in: estados };

    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.mesa) where.mesa = filtros.mesa;
    if (filtros.telefono) where.telefono = { contains: filtros.telefono };
    if (filtros.desde || filtros.hasta) {
      where.creadoEn = {
        ...(filtros.desde ? { gte: new Date(filtros.desde) } : {}),
        ...(filtros.hasta ? { lte: new Date(filtros.hasta) } : {}),
      };
    }

    // Sucursal: explicita si es privilegiado, o la del empleado
    const privilegiado = ctx.rol === 'DUENO' || ctx.rol === 'ENCARGADO';
    const sucursalFiltro = privilegiado ? (filtros.sucursalId ?? null) : (ctx.sucursalId ?? null);
    if (sucursalFiltro) where.sucursalId = sucursalFiltro;

    const [data, total] = await Promise.all([
      this.prisma.pedido.findMany({
        where, orderBy: { creadoEn: 'desc' }, skip, take,
        include: {
          sucursal: { select: { id: true, nombre: true, slug: true } },
          empleadoAsignado: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.pedido.count({ where }),
    ]);

    const serializados = data.map((p) => ({
      ...p,
      subtotal: Number(p.subtotal),
      costoEnvio: p.costoEnvio !== null ? Number(p.costoEnvio) : null,
      total: Number(p.total),
    }));
    return paginar(serializados, total, page, pageSize);
  }

  async obtenerPedido(negocioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, negocioId },
      include: {
        sucursal: { select: { id: true, nombre: true, slug: true } },
        cliente: { select: { id: true, nombre: true } },
        empleadoAsignado: { select: { id: true, nombre: true } },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return {
      ...pedido,
      subtotal: Number(pedido.subtotal),
      costoEnvio: pedido.costoEnvio !== null ? Number(pedido.costoEnvio) : null,
      total: Number(pedido.total),
    };
  }

  async cambiarEstado(negocioId: string, pedidoId: string, dto: CambiarEstadoPedidoDto, ctx: PedidoCtx) {
    const pedido = await this.exigirPedido(negocioId, pedidoId);

    if (!transicionValidaParaTipo(pedido.estado, dto.estado, pedido.tipo)) {
      throw new BadRequestException(
        `Transicion invalida: ${pedido.estado} -> ${dto.estado}`,
      );
    }
    if (dto.estado === EstadoPedido.RECHAZADO && (!dto.motivo || dto.motivo.trim().length < 10)) {
      throw new BadRequestException('Para rechazar un pedido hay que indicar un motivo (minimo 10 caracteres)');
    }

    const ahora = new Date();
    const actualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: {
        estado: dto.estado,
        ...(dto.estado === EstadoPedido.RECHAZADO ? { motivoRechazo: dto.motivo?.trim() ?? null } : {}),
        ...(dto.estado === EstadoPedido.CONFIRMADO ? { confirmadoEn: ahora } : {}),
        ...(dto.estado === EstadoPedido.ENVIADO ? { enviadoEn: ahora } : {}),
        ...(dto.estado === EstadoPedido.ENTREGADO ? { entregadoEn: ahora } : {}),
      },
      include: { sucursal: { select: { id: true, nombre: true, slug: true } } },
    });

    await this.auditoria.registrar({
      negocioId, accion: `pedido.${dto.estado.toLowerCase()}`, empleadoId: ctx.empleadoId,
      detalle: { pedidoId, desde: pedido.estado, hacia: dto.estado, motivo: dto.motivo ?? null },
      ip: ctx.ip,
    });

    this.gateway.emitirEstado(pedidoId, actualizado.clienteId, {
      pedidoId,
      estado: dto.estado,
      actualizadoEn: actualizado.actualizadoEn.toISOString(),
      motivoRechazo: actualizado.motivoRechazo,
    });

    // Push al cliente (si tiene suscripcion): encola, no bloquea
    if (actualizado.clienteId && TITULO_POR_ESTADO[dto.estado]) {
      await this.push.enviarACliente(actualizado.clienteId, {
        title: TITULO_POR_ESTADO[dto.estado] as string,
        body: MENSAJE_POR_ESTADO[dto.estado] ?? '',
        url: `/pedidos/${pedidoId}`,
        tag: `pedido-${pedidoId}`,
      }).catch((e) => this.logger.warn(`Push de estado fallo: ${(e as Error).message}`));
    }

    return {
      ...actualizado,
      subtotal: Number(actualizado.subtotal),
      costoEnvio: actualizado.costoEnvio !== null ? Number(actualizado.costoEnvio) : null,
      total: Number(actualizado.total),
    };
  }

  /** El cliente cancela su propio pedido (solo PENDIENTE o CONFIRMADO). */
  async cancelarPedido(negocioId: string, pedidoId: string, clienteId: string) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, negocioId },
      select: { id: true, clienteId: true, estado: true, sucursalId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.clienteId !== clienteId) {
      throw new ForbiddenException('Ese pedido no es tuyo');
    }
    // El CLIENTE puede cancelar desde PENDIENTE o CONFIRMADO. Ojo: la tabla de
    // transiciones del STAFF no incluye PENDIENTE -> CANCELADO (para el staff es
    // PENDIENTE -> CONFIRMADO | RECHAZADO), asi que no se puede reusar aca:
    // hacerlo devolvia 400 en un caso que el prompt permite.
    if (pedido.estado !== EstadoPedido.PENDIENTE && pedido.estado !== EstadoPedido.CONFIRMADO) {
      throw new BadRequestException(
        `Ya no se puede cancelar: el pedido esta en ${pedido.estado}`,
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { estado: EstadoPedido.CANCELADO },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'pedido.cancelado_por_cliente', clienteId,
      detalle: { pedidoId, desde: pedido.estado },
    });

    this.gateway.emitirCancelado(negocioId, pedido.sucursalId, {
      pedidoId, estado: EstadoPedido.CANCELADO,
      actualizadoEn: actualizado.actualizadoEn.toISOString(),
    });

    return { ok: true, pedidoId, estado: EstadoPedido.CANCELADO };
  }

  /**
   * Estadisticas de pedidos. Los agrupamientos simples van con groupBy; el
   * ranking de items necesita parsear el JSON, asi que se hace en memoria
   * sobre UNA sola query (no hay N+1).
   */
  async obtenerEstadisticas(negocioId: string, desde?: string, hasta?: string) {
    const rango: Prisma.PedidoWhereInput = {
      negocioId,
      ...((desde || hasta)
        ? { creadoEn: { ...(desde ? { gte: new Date(desde) } : {}), ...(hasta ? { lte: new Date(hasta) } : {}) } }
        : {}),
    };

    const [porEstado, porTipo, porPago, agregado, porHora, pedidos] = await Promise.all([
      this.prisma.pedido.groupBy({ by: ['estado'], where: rango, _count: { _all: true } }),
      this.prisma.pedido.groupBy({ by: ['tipo'], where: rango, _count: { _all: true } }),
      this.prisma.pedido.groupBy({ by: ['modoPago'], where: rango, _count: { _all: true } }),
      this.prisma.pedido.aggregate({ where: rango, _avg: { total: true }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ hora: number; total: bigint }>>`
        SELECT EXTRACT(HOUR FROM "creadoEn")::int AS hora, COUNT(*)::bigint AS total
        FROM "Pedido" WHERE "negocioId" = ${negocioId}
        GROUP BY 1 ORDER BY 1 ASC
      `,
      this.prisma.pedido.findMany({ where: rango, select: { items: true, total: true } }),
    ]);

    // Top 5 items: una sola pasada sobre los JSON ya traidos
    const contador = new Map<string, { nombre: string; cantidad: number }>();
    let ingresos = 0;
    for (const p of pedidos) {
      ingresos += Number(p.total);
      const items = Array.isArray(p.items) ? (p.items as Array<Record<string, any>>) : [];
      for (const it of items) {
        const clave = String(it.itemId ?? it.nombre);
        const previo = contador.get(clave) ?? { nombre: String(it.nombre ?? clave), cantidad: 0 };
        previo.cantidad += Number(it.cantidad ?? 0);
        contador.set(clave, previo);
      }
    }
    const topItems = [...contador.entries()]
      .map(([itemId, v]) => ({ itemId, ...v }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);
    const encontrados = topItems.length
      ? await this.prisma.itemCarta.findMany({
          where: { id: { in: topItems.map((t) => t.itemId) } }, select: { id: true, precio: true },
        })
      : [];
    const precioPorId = new Map(encontrados.map((i) => [i.id, Number(i.precio)]));
    for (const t of topItems) {
      (t as Record<string, unknown>).ingresoEstimado =
        Number(((precioPorId.get(t.itemId) ?? 0) * t.cantidad).toFixed(2));
    }

    return {
      totales: {
        pedidos: agregado._count._all,
        ticketPromedio: Number(Number(agregado._avg.total ?? 0).toFixed(2)),
        ingresos: Number(ingresos.toFixed(2)),
      },
      porEstado: porEstado.map((e) => ({ estado: e.estado, total: e._count._all })),
      porTipo: porTipo.map((e) => ({ tipo: e.tipo, total: e._count._all })),
      porModoPago: porPago.map((e) => ({ modoPago: e.modoPago, total: e._count._all })),
      topItems,
      porHora: porHora.map((h) => ({ hora: Number(h.hora), total: Number(h.total) })),
    };
  }

  /** Historial completo (incluye cerrados). */
  async historial(negocioId: string, filtros: FiltrarPedidosDto, ctx: { sucursalId?: string | null; rol?: string }) {
    return this.listarPedidos(negocioId, { ...filtros, incluirCerrados: true }, ctx);
  }

  private async exigirPedido(negocioId: string, pedidoId: string) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, negocioId },
      select: { id: true, estado: true, tipo: true, clienteId: true, sucursalId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }
}
