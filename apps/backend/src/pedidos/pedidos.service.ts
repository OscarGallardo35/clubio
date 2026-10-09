
import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable,
  Logger, NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoPedido, Prisma, TipoVisita } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { FidelizacionService } from '../fidelizacion/fidelizacion.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PushService } from '../push/push.service';
import { DisparosService } from '../push/disparos.service';
import type { ResultadoAcreditacion } from '../fidelizacion/fidelizacion.service';
import { AsignacionPedidosService } from '../turnos/asignacion-pedidos.service';
import { LimitesService } from '../planes/limites.service';
import { normalizarTelefonoE164 } from '../common/utils/phone.util';
import { COOKIE_CLIENTE, leerCookie } from '../common/utils/cookie.util';
import { getPagination, paginar } from '../common/utils/pagination.util';
import { requireEnv } from '../common/utils/env.util';
import { PedidosGateway } from './pedidos.gateway';
import { calcularTotales } from './helpers/calcular-totales';
import { construirUrlCorta, generarLinkToken, calcularExpiracion, linkVencido } from './helpers/generar-link-corto';
import { generarMensajeWhatsApp } from './helpers/generar-mensaje-whatsapp';
import {
  ESTADOS_ACTIVOS, MENSAJE_POR_ESTADO, TITULO_POR_ESTADO, transicionValidaParaTipo,
} from './helpers/transiciones-estado';
import type { ItemInput, ItemPedido, PedidoCtx } from './interfaces/pedido-item.interface';
import type { CrearPedidoDto } from './dto/crear-pedido.dto';
import type { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto';
import type { FiltrarPedidosDto } from './dto/filtrar-pedidos.dto';

const MAX_REINTENTOS_LINK = 3;

/** Horas que un pedido puede quedar en PENDIENTE sin que el local lo confirme antes de auto-cancelarlo. */
const AUTO_CANCELAR_HORAS = 6;
const MOTIVO_AUTO_CANCELADO = 'Auto-cancelado por inactividad';

@Injectable()
export class PedidosService {
  private readonly logger = new Logger('Pedidos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
    private readonly configuracion: ConfiguracionService,
    private readonly push: PushService,
    private readonly disparos: DisparosService,
    private readonly gateway: PedidosGateway,
    private readonly jwt: JwtService,
    private readonly asignacion: AsignacionPedidosService,
    private readonly limites: LimitesService,
    private readonly fidelizacion: FidelizacionService,
  ) {}

  /**
   * Refinamiento 4 + Fase 0: POST /pedidos es publico, pero si viene un JWT de cliente
   * valido se vincula. Dos fuentes, en este orden:
   *   1. `Authorization: Bearer ...` (por si la PWA tiene el token en memoria).
   *   2. La cookie HttpOnly `cliente_token`, que es la sesion REAL de la PWA Cliente.
   *
   * Sin la (2) TODOS los pedidos del menu entraban como invitados aunque el cliente estuviera
   * logueado: verificado en prod, 30 de 30 pedidos con `clienteId = null`. Eso rompia el vinculo
   * visita<->pedido y la acreditacion del pedido entregado.
   *
   * Token invalido o de otro tipo -> guest (no se rechaza: el pedido igual se puede hacer).
   */
  async identificarClienteOpcional(authHeader?: string, cookieHeader?: string): Promise<string | null> {
    const [scheme, bearer] = String(authHeader ?? '').split(' ');
    const token = scheme === 'Bearer' && bearer ? bearer : leerCookie(cookieHeader, COOKIE_CLIENTE);
    if (!token) return null;
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

    // Gating por plan. DELIVERY es condicional al tipo: no puede ser decorador,
    // se valida en el servicio.
    if (dto.tipo === 'DELIVERY') {
      await this.limites.exigirFeature(negocioId, 'delivery');
    }
    // PEDIDOS_MES: con pay-per-use NO bloquea (verificar adentro lo contempla),
    // solo se cobra el excedente y se avisa al 100%/150%.
    await this.limites.exigirLimite(negocioId, 'PEDIDOS_MES');

    // Refinamientos 1 y 2: config EFECTIVA (global + override de la sucursal)
    const config = await this.configuracion.configEfectiva(negocioId, sucursalId) as unknown as {
      menuActivo: boolean;
      tiposPedidoHabilitados: string[];
      modosPagoHabilitados: string[];
      costoEnvio: unknown;
      pedidoMinimoDelivery: unknown;
    };

    if (config.menuActivo !== true) {
      throw new BadRequestException('El menu digital no esta activo en este negocio');
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

    // Refinamiento 6 + recalculo de precios desde la DB + override por sucursal.
    // `sucursalId` ya esta resuelto arriba: NO se vuelve a resolver.
    const { items, subtotal, costoEnvio, total } = await calcularTotales(
      this.prisma, negocioId, sucursalId, dto.items as ItemInput[], dto.tipo, config,
    );

    // #2.8: a quien notificar y si ya queda un empleado asignado.
    // Se calcula ANTES del create para guardar empleadoAsignadoId / encargadoId
    // / numeroAtendiente en la misma escritura (sin update extra).
    const dest = await this.asignacion.determinarDestinatarios(negocioId, {
      sucursalId, tipo: dto.tipo,
    });

    // Un pedido ACTIVO por cliente (hibrido): con sesion se mira el `clienteId` —un telefono
    // compartido (el fijo del local, el celular de la familia) no deberia bloquear a alguien
    // logueado—; sin sesion, el telefono normalizado, que es la unica identidad del guest.
    // Alcance NEGOCIO (no sucursal): "ya tenes un pedido" es del negocio, no de la sucursal.
    const whereActivo = {
      negocioId,
      estado: { in: ESTADOS_ACTIVOS },
      ...(clienteId ? { clienteId } : { telefono }),
    };

    // El chequeo y el create van en la MISMA transaccion, detras de un advisory lock por
    // identidad: el read-then-write de antes no era atomico, asi que dos POST concurrentes del
    // mismo telefono (doble tap, o el reintento del checkout) pasaban los dos y quedaban DOS
    // pedidos activos. El 409 reporta solo el mas reciente: se cancelaba ese y el otro seguia
    // bloqueando -> el loop "cancelar y reintentar" intermitente.
    // Link corto de 128 bits, con reintento ante colision del unique.
    let pedido: Record<string, any> | null = null;
    let linkToken = '';
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${negocioId}:${clienteId ?? telefono}`}))`;

      const activo = await tx.pedido.findFirst({
        where: whereActivo,
        orderBy: { creadoEn: 'desc' },
        select: { id: true, linkToken: true, estado: true, linkExpiraEn: true },
      });
      if (activo) {
        // Mas de uno = residuo de cuando el chequeo no era atomico (hoy el lock lo impide).
        // Va en la respuesta para que la PWA pueda explicar por que el CTA vuelve.
        const activos = await tx.pedido.count({ where: whereActivo });
        // El payload extra viaja al cliente: `linkToken` es lo que necesita para ofrecerle
        // "ver mi pedido" / "cancelarlo" en el checkout.
        throw new ConflictException({
          message: 'Ya tenes un pedido activo. Cancelalo o espera a que termine.',
          pedidoId: activo.id,
          linkToken: activo.linkToken,
          estado: activo.estado,
          linkVigente: !linkVencido(activo.linkExpiraEn),
          activos,
        });
      }

      for (let intento = 0; intento < MAX_REINTENTOS_LINK && !pedido; intento++) {
        linkToken = generarLinkToken();
        try {
          pedido = await tx.pedido.create({
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
              empleadoAsignadoId: dest.empleadoAsignado,
              encargadoId: dest.encargadoId,
              numeroAtendiente: dest.numeroAtendiente,
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
    });
    if (!pedido) throw new BadRequestException('No se pudo generar el link del pedido');

    const urlCorta = construirUrlCorta(linkToken, await this.slugDelNegocio(negocioId));
    const mensajeWhatsApp = generarMensajeWhatsApp({
      nombreCliente: pedido.nombreCliente, items, subtotal, costoEnvio, total,
      tipo: dto.tipo, mesa: pedido.mesa, modoPago: dto.modoPago, notas: pedido.notas, urlCorta,
    });

    await this.auditoria.registrar({
      negocioId, accion: 'pedido.creado',
      detalle: {
        pedidoId: pedido.id, sucursalId, tipo: dto.tipo, total, items: items.length,
        // Detalle de la asignacion: va a auditoria (no en la respuesta publica)
        asignacionModo: dest.modoEfectivo,
        asignacionMotivo: dest.motivo,
        empleadoAsignadoId: dest.empleadoAsignado,
        encargadoId: dest.encargadoId,
        notificados: dest.empleadosNotificados.length,
        notificadosIds: dest.empleadosNotificados,
      },
    });

    // Cuenta el pedido recien creado (despues de escribir, no antes).
    await this.limites.incrementarUso(negocioId, 'PEDIDOS_MES');

    // #2.8: WebSocket a los empleados NOTIFICADOS (empleado:{id}).
    // emitirPedidoNuevo cae a la sala de la sucursal si la lista viene vacia.
    this.gateway.emitirPedidoNuevo({
      negocioId, sucursalId, pedidoId: pedido.id, linkToken,
      nombreCliente: pedido.nombreCliente, total, tipo: dto.tipo,
      mesa: pedido.mesa, creadoEn: pedido.creadoEn,
      empleadosNotificados: dest.empleadosNotificados,
      empleadoAsignadoId: dest.empleadoAsignado,
      numeroAtendiente: dest.numeroAtendiente,
    });

    // Push a cada notificado (encola, no bloquea). Si no hay notificados cae
    // al aviso por sucursal para no dejar el pedido sin avisar.
    const aviso = {
      title: 'Nuevo pedido',
      body: `${pedido.nombreCliente}: ${items.length} item(s) - $${total}`,
      url: '/pedidos',
      tag: 'pedido-nuevo',
    };
    if (dest.empleadosNotificados.length) {
      await Promise.all(
        dest.empleadosNotificados.map((empId) =>
          this.push.enviarAEmpleado(negocioId, empId, aviso)
            .catch((e) => this.logger.warn(`Push a ${empId} fallo: ${(e as Error).message}`)),
        ),
      );
    } else {
      await this.push.enviarAEmpleadosDelNegocio(negocioId, aviso, sucursalId)
        .catch((e) => this.logger.warn(`Push de pedido nuevo fallo: ${(e as Error).message}`));
    }

    return {
      pedidoId: pedido.id,
      linkToken,
      urlCorta,
      mensajeWhatsApp,
      expiraEn: pedido.linkExpiraEn,
      total,
      sucursalId,
      // OJO: NO se devuelve el detalle de la asignacion (empleadoAsignadoId /
      // encargadoId / notificados). Este endpoint es PUBLICO (lo llama la PWA
      // Cliente y un guest): exponer IDs de empleados seria una fuga. El detalle
      // queda en la auditoria y en los logs del server.
    };
  }

  /**
   * #2.8: un empleado TOMA el pedido (modo BROADCAST).
   *
   * El filtro `empleadoAsignadoId: null` va DENTRO del WHERE del updateMany: es
   * atomico. Un findFirst + update tendria una ventana entre el chequeo y la
   * escritura, y dos meseros podrian quedarse con el mismo pedido.
   */
  async tomarPedido(negocioId: string, pedidoId: string, empleado: { id: string; nombre: string; sucursalId?: string | null }) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, negocioId },
      select: { id: true, estado: true, empleadoAsignadoId: true, sucursalId: true, nombreCliente: true, tipo: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { modoAsignacionPedidos: true },
    });
    if (config?.modoAsignacionPedidos !== 'BROADCAST') {
      throw new BadRequestException(
        'Solo se pueden tomar pedidos cuando el modo de asignacion es BROADCAST',
      );
    }
    if (pedido.empleadoAsignadoId === empleado.id) {
      return { ok: true, yaAsignado: true, pedidoId, empleadoAsignadoId: empleado.id };
    }

    const r = await this.prisma.pedido.updateMany({
      where: { id: pedidoId, negocioId, empleadoAsignadoId: null },
      data: { empleadoAsignadoId: empleado.id },
    });
    if (r.count === 0) {
      throw new ConflictException('Otro empleado ya tomo este pedido');
    }

    await this.auditoria.registrar({
      negocioId, accion: 'pedido.tomado', empleadoId: empleado.id,
      detalle: { pedidoId, empleadoAsignado: empleado.nombre },
    });

    // Avisar a los demas notificados
    const dest = await this.asignacion.determinarDestinatarios(negocioId, {
      sucursalId: pedido.sucursalId, tipo: pedido.tipo,
    });
    this.gateway.emitirPedidoAsignado(negocioId, pedido.sucursalId, {
      pedidoId, empleadoAsignadoId: empleado.id, nombreEmpleado: empleado.nombre,
      empleadosNotificados: dest.empleadosNotificados.filter((e) => e !== empleado.id),
    });

    return { ok: true, pedidoId, empleadoAsignadoId: empleado.id };
  }

  /** GET /pedidos/publico/:linkToken — el token ES la autenticacion. */
  async obtenerPedidoPorLink(negocioId: string, linkToken: string) {
    // SELECT de lista blanca (no `include` + spread): este endpoint es PUBLICO y se entra solo con
    // el linkToken, asi que no puede devolver IDs internos (empleadoAsignadoId, encargadoId,
    // negocioId, sucursalId, clienteId). POST /pedidos ya excluia la asignacion a proposito; este
    // endpoint devolvia el row completo por el spread y se contradecia con ese estandar.
    // Se usa lista BLANCA y no lista negra: si manana se agrega una columna interna, no se filtra
    // sola ni hace falta acordarse de excluirla.
    const pedido = await this.prisma.pedido.findFirst({
      where: { negocioId, linkToken },
      select: {
        id: true,
        linkToken: true,
        linkExpiraEn: true,
        nombreCliente: true,
        telefono: true,
        direccion: true,
        mesa: true,
        origen: true,
        tipo: true,
        modoPago: true,
        estado: true,
        notas: true,
        motivoRechazo: true,
        subtotal: true,
        costoEnvio: true,
        total: true,
        numeroAtendiente: true,
        items: true,
        creadoEn: true,
        confirmadoEn: true,
        enviadoEn: true,
        entregadoEn: true,
        sucursal: { select: { nombre: true, slug: true } },
        cliente: { select: { nombre: true } },
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
      // El mensaje pre-armado NO se persiste: se rearma desde la fila para que el staff pueda
      // reenviarselo al cliente desde el detalle. Antes el detalle lo leia del response y
      // siempre venia `undefined` (solo lo armaba crearPedido), asi que el boton abria
      // WhatsApp SIN texto.
      ...(this.mensajeWhatsAppDelPedido(pedido, await this.slugDelNegocio(negocioId)) ?? {}),
    };
  }

  /**
   * Slug del negocio, para armar los links que van a la PWA Staff multi-tenant.
   *
   * El slug SIEMPRE sale del negocio (del pedido / de la visita), nunca de una variable global: con
   * un slug fijo, el pedido de un local termina en la pantalla de otro y el backend lo busca en el
   * negocio equivocado ("pedido no encontrado").
   */
  private async slugDelNegocio(negocioId: string): Promise<string> {
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { slug: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    return negocio.slug;
  }

  /**
   * Mensaje pre-armado de un pedido YA persistido (el que usa el detalle del staff).
   *
   * Devuelve `null` si el link no esta disponible: `construirUrlCorta` con un `linkToken`
   * vacio produce `.../validar-pedido?ref=` sin token — peor que no ofrecer el boton. El
   * scheduler borra el `linkToken` a los 7 dias de vencido, asi que el caso es real.
   */
  private mensajeWhatsAppDelPedido(pedido: {
    nombreCliente: string; items: unknown; subtotal: unknown; costoEnvio: unknown;
    total: unknown; tipo: string; mesa: string | null; modoPago: string; notas: string | null;
    linkToken: string | null; linkExpiraEn: Date | null;
  }, slugNegocio: string): { mensajeWhatsApp: string } | null {
    if (!pedido.linkToken || linkVencido(pedido.linkExpiraEn)) return null;

    // El JSON guardado puede venir de versiones viejas: se normaliza `modificadores` porque
    // generarMensajeWhatsApp lo recorre con `.length`.
    const items = (Array.isArray(pedido.items) ? pedido.items : []).map((i) => {
      const fila = i as Record<string, unknown>;
      return { ...fila, modificadores: Array.isArray(fila.modificadores) ? fila.modificadores : [] };
    }) as unknown as ItemPedido[];

    return {
      mensajeWhatsApp: generarMensajeWhatsApp({
        nombreCliente: pedido.nombreCliente,
        items,
        subtotal: Number(pedido.subtotal),
        costoEnvio: Number(pedido.costoEnvio ?? 0),
        total: Number(pedido.total),
        tipo: pedido.tipo,
        mesa: pedido.mesa,
        modoPago: pedido.modoPago,
        notas: pedido.notas,
        urlCorta: construirUrlCorta(pedido.linkToken, slugNegocio),
      }),
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
    const { actualizado, acreditado } = await this.prisma.$transaction(async (tx) => {
      const ped = await tx.pedido.update({
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

      // El pedido digital (QR #1) es la OTRA puerta por la que entra el consumo: al pasar a
      // ENTREGADO acredita sellos/puntos con el MISMO servicio que usa la visita aprobada.
      // Solo si el pedido tiene cliente: un invitado (clienteId null) no tiene a quien acreditarle.
      // ENTREGADO es terminal en la tabla de transiciones, asi que no se puede acreditar dos veces.
      let acreditado: ResultadoAcreditacion | null = null;
      if (dto.estado === EstadoPedido.ENTREGADO && ped.clienteId && ped.sucursalId) {
        // Candado anti doble acreditacion (Fase 1): si una visita ya uso el total de ESTE pedido,
        // el consumo se acredito al aprobarla. Entregarlo no puede volver a acreditar.
        const yaVinculada = await tx.visita.findFirst({
          where: { pedidoId: ped.id }, select: { id: true },
        });
        if (yaVinculada) {
          this.logger.warn(
            `Pedido ${ped.id} ya acreditado por la visita ${yaVinculada.id}: no se acredita de nuevo`,
          );
        } else {
          acreditado = await this.fidelizacion.acreditar(tx, {
            negocioId,
            clienteId: ped.clienteId,
            sucursalId: ped.sucursalId,
            empleadoId: ctx.empleadoId ?? null,
            monto: Number(ped.total),
            tipo: TipoVisita.VISITA,
            metodo: 'PEDIDO',
            origen: 'PEDIDO',
            notas: null,
          });
        }
      }

      return { actualizado: ped, acreditado };
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

    // Push al cliente (si tiene suscripcion): encola, no bloquea.
    // La ruta es la del SEGUIMIENTO del cliente: `/<slug>/pedido/<linkToken>`, la MISMA que se
    // comparte por WhatsApp (ver `construirUrlCorta`). `/pedidos/<id>` NO existe en la PWA
    // Cliente (esa forma es la del Staff) y por eso el tap no abria ninguna vista. El slug lo
    // agrega `PushService.urlDePush` al encolar.
    if (actualizado.clienteId && TITULO_POR_ESTADO[dto.estado]) {
      const urlPedido = actualizado.linkToken ? `pedido/${actualizado.linkToken}` : 'tarjeta';
      await this.push.enviarACliente(actualizado.clienteId, {
        title: TITULO_POR_ESTADO[dto.estado] as string,
        body: MENSAJE_POR_ESTADO[dto.estado] ?? '',
        url: urlPedido,
        tag: `pedido-${pedidoId}`,
      }).catch((e) => this.logger.warn(`Push de estado fallo: ${(e as Error).message}`));
    }

    // DISPAROS: SELLOS (si esta transicion cambio el saldo) y COMPRA (si llego al estado
    // configurado). Van al final y aislados: un fallo del motor no debe revertir el pedido.
    try {
      if (acreditado && pedido.clienteId) {
        await this.disparos.onSaldoCambia({
          negocioId,
          clienteId: pedido.clienteId,
          sucursalId: pedido.sucursalId,
          visitaId: acreditado.visitaId,
          sellosActuales: acreditado.sellosActuales,
          sellosParaPremio: acreditado.sellosParaPremio,
        });
      }
      await this.disparos.onPedidoEstado({
        negocioId,
        pedidoId,
        clienteId: actualizado.clienteId ?? pedido.clienteId,
        sucursalId: actualizado.sucursalId,
        estadoNuevo: dto.estado,
      });
    } catch (e) {
      this.logger.warn(`Disparos de push fallaron para el pedido ${pedidoId}: ${(e as Error).message}`);
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
    return this.cancelarYNotificar(negocioId, pedido, { clienteId, origen: 'sesion' });
  }

  /**
   * Cancela por `linkToken`: la SEGUNDA puerta del cliente.
   *
   * Por que existe: `POST /pedidos` es publico y el flujo del QR #1 deja pedidos con
   * `clienteId = null` (guest que escanea y pide sin registrarse). Con la puerta de la cookie
   * esos pedidos eran INCANCELABLES: 401 sin sesion y 403 por el chequeo de ownership — o
   * sea, justo el caso mas comun. Aca el `linkToken` ES la credencial, con el mismo modelo de
   * confianza que `GET /pedidos/publico/:linkToken`.
   */
  async cancelarPedidoPorLink(negocioId: string, linkToken: string) {
    const pedido = await this.prisma.pedido.findFirst({
      where: { negocioId, linkToken },
      select: { id: true, clienteId: true, estado: true, sucursalId: true, linkExpiraEn: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    // OJO: a proposito NO se exige que el link este vigente (a diferencia del GET publico, que
    // devuelve 410). El vencimiento a las 4 h limita el SEGUIMIENTO publico, no la cancelacion: el
    // caso tipico —y el que motivo este codigo— es un pedido activo cuyo link ya vencio, donde
    // cancelar es la UNICA salida del cliente (el 409 del checkout lo lleva justo aca).
    // Las protecciones siguen: el `linkToken` (128 bits) es la credencial, el cron lo borra a los
    // 7 dias de vencido (despues -> 404) y el estado tiene que ser PENDIENTE o CONFIRMADO, asi que
    // un pedido ya en preparacion no se cae ni con el link vivo.
    return this.cancelarYNotificar(negocioId, pedido, { clienteId: pedido.clienteId, origen: 'link' });
  }

  /**
   * Reglas de cancelacion del cliente, compartidas por las DOS puertas (cookie y link): solo
   * desde PENDIENTE o CONFIRMADO.
   *
   * Ojo: la tabla de transiciones del STAFF no incluye `PENDIENTE -> CANCELADO` (para el staff
   * es `-> CONFIRMADO | RECHAZADO`), asi que no se puede reusar `transicionValidaParaTipo`:
   * hacerlo devolvia 400 en un caso que el pedido permite.
   */
  private async cancelarYNotificar(
    negocioId: string,
    pedido: { id: string; estado: EstadoPedido; sucursalId: string; clienteId: string | null },
    ctx: { clienteId: string | null; origen: 'sesion' | 'link' },
  ) {
    if (pedido.estado !== EstadoPedido.PENDIENTE && pedido.estado !== EstadoPedido.CONFIRMADO) {
      throw new BadRequestException(
        `Ya no se puede cancelar: el pedido esta en ${pedido.estado}`,
      );
    }

    const actualizado = await this.prisma.pedido.update({
      where: { id: pedido.id },
      data: { estado: EstadoPedido.CANCELADO },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'pedido.cancelado_por_cliente', clienteId: ctx.clienteId,
      detalle: { pedidoId: pedido.id, desde: pedido.estado, origen: ctx.origen },
    });

    this.gateway.emitirCancelado(negocioId, pedido.sucursalId, pedido.clienteId, {
      pedidoId: pedido.id, estado: EstadoPedido.CANCELADO,
      actualizadoEn: actualizado.actualizadoEn.toISOString(),
    });

    return { ok: true, pedidoId: pedido.id, estado: EstadoPedido.CANCELADO };
  }

  /**
   * Auto-cancelar los pedidos PENDIENTE abandonados (mas de 6 h sin que el local los confirme).
   *
   * SOLO PENDIENTE. `CONFIRMADO` significa que el local ACEPTO el pedido: moverlo es su
   * responsabilidad, y cancelar un delivery ENVIADO en curso seria peor que dejarlo. Por eso no
   * se toca ningun otro estado.
   *
   * Se recorre negocio por negocio en vez de una query global: hoy RLS NO esta activo (ver la nota
   * de RLS en BACKEND_PLAN), asi que el `negocioId` explicito en cada where es la unica barrera
   * real de aislamiento — y ademas da el conteo por negocio para el log.
   *
   * Idempotente: cada pedido se cierra con un `updateMany` que exige `estado: PENDIENTE` en el
   * WHERE (operacion atomica). Si el local lo confirmo un instante antes, `count` es 0 y no se
   * emite ni se audita nada. Si no hay candidatos, no se escribe ni se loguea.
   *
   * La logica vive aca y no en el `@Cron` para poder invocarla con cualquier `ahora` sin esperar a
   * la hora en punto (mismo criterio que los crons del #2.9).
   *
   * Si el pedido tiene cliente logueado se le avisa por WS (`emitirCancelado` emite
   * tambien a su sala `cliente:{id}`), pero NO se manda push/WhatsApp: si el
   * pedido es viejo, su link ya vencio. Avisar antes de cancelar queda como
   * enhancement.
   */
  async autoCancelarPendientesAbandonados(
    ahora = new Date(),
    soloNegocioId?: string,
  ): Promise<{ negocios: number; cancelados: number }> {
    const corte = new Date(ahora.getTime() - AUTO_CANCELAR_HORAS * 3_600_000);
    const negocios = await this.prisma.negocio.findMany({
      where: { activo: true, ...(soloNegocioId ? { id: soloNegocioId } : {}) },
      select: { id: true },
    });

    let total = 0;
    const porNegocio: Array<{ negocioId: string; cancelados: number }> = [];

    for (const negocio of negocios) {
      const candidatos = await this.prisma.pedido.findMany({
        where: { negocioId: negocio.id, estado: EstadoPedido.PENDIENTE, creadoEn: { lt: corte } },
        select: { id: true, sucursalId: true, clienteId: true },
      });
      if (!candidatos.length) continue;

      let cancelados = 0;
      for (const candidato of candidatos) {
        const r = await this.prisma.pedido.updateMany({
          where: { id: candidato.id, negocioId: negocio.id, estado: EstadoPedido.PENDIENTE },
          data: { estado: EstadoPedido.CANCELADO, motivoRechazo: MOTIVO_AUTO_CANCELADO },
        });
        if (r.count !== 1) continue; // el local lo movio en el medio: ya no es nuestro

        cancelados += 1;
        // Mismo evento que el cancel manual: el staff lo ve caer en vivo. Si el
        // pedido tiene cliente logueado (sala cliente:{id}), tambien lo ve el.
        this.gateway.emitirCancelado(negocio.id, candidato.sucursalId, candidato.clienteId, {
          pedidoId: candidato.id,
          estado: EstadoPedido.CANCELADO,
          actualizadoEn: ahora.toISOString(),
          motivo: MOTIVO_AUTO_CANCELADO,
        });
        await this.auditoria.registrar({
          negocioId: negocio.id, accion: 'pedido.auto_cancelado',
          detalle: {
            pedidoId: candidato.id, desde: EstadoPedido.PENDIENTE,
            motivo: MOTIVO_AUTO_CANCELADO, horasInactividad: AUTO_CANCELAR_HORAS,
          },
        });
      }

      if (cancelados) {
        total += cancelados;
        porNegocio.push({ negocioId: negocio.id, cancelados });
      }
    }

    if (porNegocio.length) {
      this.logger.log(
        `Auto-cancelados ${total} PENDIENTE con mas de ${AUTO_CANCELAR_HORAS} h: ` +
          porNegocio.map((n) => `${n.negocioId}=${n.cancelados}`).join(' '),
      );
    }
    return { negocios: porNegocio.length, cancelados: total };
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
