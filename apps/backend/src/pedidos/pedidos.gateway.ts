
import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { COOKIE_CLIENTE, COOKIE_EMPLEADO, leerCookie } from '../common/utils/cookie.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WebSocket de pedidos (namespace /pedidos, separado del /visitas).
 *
 * Salas:
 *   cliente:{clienteId}               -> el cliente sigue SU pedido
 *   pedido:{pedidoId}                 -> estado en vivo mientras creo el pedido
 *   sucursal:{sucursalId}:empleados   -> SOLO el staff de esa sucursal
 *   negocio:{negocioId}:duenos        -> el dueno ve todas las sucursales
 *
 * IMPORTANTE (correccion sobre el prompt original): NO se emite a
 * negocio:{negocioId}:empleados. Con multi-sucursal desde el dia 1, un pedido
 * de Norte no debe sonar en la tablet de Centro.
 */
@WebSocketGateway({ namespace: '/pedidos', cors: { origin: true, credentials: true } })
export class PedidosGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('PedidosGateway');

  @WebSocketServer() server!: Server;

  constructor(
    private readonly wsGuard: WsJwtGuard,
    private readonly prisma: PrismaService,
  ) {}

  static salaSucursal(sucursalId: string) { return `sucursal:${sucursalId}:empleados`; }
  static salaDuenos(negocioId: string) { return `negocio:${negocioId}:duenos`; }
  static salaCliente(clienteId: string) { return `cliente:${clienteId}`; }
  static salaPedido(pedidoId: string) { return `pedido:${pedidoId}`; }
  /** #2.8: notificacion INDIVIDUAL al empleado destinatario. */
  static salaEmpleado(empleadoId: string) { return `empleado:${empleadoId}`; }

  private tokenDe(socket: Socket): string {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    if (typeof auth?.token === 'string') return auth.token;
    const q = socket.handshake.query?.token;
    if (typeof q === 'string') return q;
    const h = socket.handshake.headers?.authorization ?? '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    // Cookies HttpOnly (mismo criterio que el gateway de visitas). Sin esto, el
    // socket del staff dependia del token en memoria y un F5 en /pedidos lo dejaba
    // sin recibir `pedido:nuevo`. La de EMPLEADO va primero: un token de cliente
    // nunca pasa por el canal de staff (WsJwtGuard valida el claim `tipo`).
    const deEmpleado = leerCookie(socket.handshake.headers?.cookie, COOKIE_EMPLEADO);
    if (deEmpleado) return deEmpleado;
    return leerCookie(socket.handshake.headers?.cookie, COOKIE_CLIENTE);
  }

  async handleConnection(socket: Socket) {
    try {
      const identidad = await this.wsGuard.validarToken(this.tokenDe(socket));
      if (!identidad) {
        socket.emit('error', { message: 'No autenticado' });
        socket.disconnect(true);
        return;
      }
      socket.data.identidad = identidad;

      if (identidad.tipo === 'cliente') {
        await socket.join(PedidosGateway.salaCliente(identidad.clienteId));
      } else {
        // #2.8: sala individual. El motor de asignacion notifica a empleado:{id}
        // en vez de a toda la sucursal.
        await socket.join(PedidosGateway.salaEmpleado(identidad.empleadoId));
        if (identidad.sucursalId) await socket.join(PedidosGateway.salaSucursal(identidad.sucursalId));
        if (identidad.accesoMultiSucursal) {
          const sucursales = await this.prisma.sucursal.findMany({
            where: { negocioId: identidad.negocioId }, select: { id: true },
          });
          for (const s of sucursales) await socket.join(PedidosGateway.salaSucursal(s.id));
        }
        if (identidad.rol === 'DUENO') await socket.join(PedidosGateway.salaDuenos(identidad.negocioId));
      }

      // El cliente puede pedir seguir un pedido concreto al crear.
      const auth = socket.handshake.auth as Record<string, unknown> | undefined;
      const pedidoId = typeof auth?.pedidoId === 'string' ? auth.pedidoId : undefined;
      if (pedidoId) {
        const propio = await this.prisma.pedido.findFirst({
          where: {
            id: pedidoId,
            negocioId: identidad.negocioId,
            ...(identidad.tipo === 'cliente' ? { clienteId: identidad.clienteId } : {}),
          },
          select: { id: true },
        });
        if (propio) await socket.join(PedidosGateway.salaPedido(pedidoId));
        else this.logger.warn(`No se pudo unir a pedido:${pedidoId} (no es suyo o no existe)`);
      }

      socket.emit('conectado', { tipo: identidad.tipo, salas: [...socket.rooms] });
    } catch (e) {
      this.logger.warn(`Handshake fallo: ${(e as Error).message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    // El pedido NO se elimina: sigue en la base.
    socket.data.identidad = undefined;
  }

  /** Se emitido al crear un pedido: solo a la sucursal destino + duenos. */
  emitirNuevo(payload: {
    negocioId: string; sucursalId: string; pedidoId: string; linkToken: string;
    nombreCliente: string; total: number; tipo: string; mesa?: string | null; creadoEn: Date;
  }) {
    const cuerpo = { ...payload, emitidoEn: new Date().toISOString() };
    // .to(a).to(b).emit() ENCADENADO: Socket.IO une las salas y entrega UNA sola
    // copia por socket. Con dos .emit() separados, un dueno con
    // accesoMultiSucursal (que esta en la sala de sucursal Y en la de duenos)
    // recibia el evento DUPLICADO.
    this.server
      .to(PedidosGateway.salaSucursal(payload.sucursalId))
      .to(PedidosGateway.salaDuenos(payload.negocioId))
      .emit('pedido:nuevo', cuerpo);
    return cuerpo;
  }

  /**
   * #2.8: emite pedido:nuevo a los empleados NOTIFICADOS (sala empleado:{id}).
   * Si la lista viene vacia cae a la sala de la sucursal para no dejar el
   * pedido sin avisar.
   *
   * Emits ENCADENADOS: Socket.IO deduplica por socket. Con .emit() separados un
   * empleado que este en varias de las salas destino lo recibiria duplicado.
   */
  emitirPedidoNuevo(
    payload: {
      negocioId: string; sucursalId: string; pedidoId: string; linkToken: string;
      nombreCliente: string; total: number; tipo: string; mesa?: string | null;
      creadoEn: Date; empleadosNotificados: string[];
      empleadoAsignadoId?: string | null; numeroAtendiente?: string | null;
    },
  ) {
    const { empleadosNotificados, negocioId, sucursalId, ...resto } = payload;
    const cuerpo = { ...resto, negocioId, sucursalId, emitidoEn: new Date().toISOString() };

    // Si no hay notificados, cae a la sala de la sucursal (no dejar sin avisar).
    const salas = empleadosNotificados.length
      ? empleadosNotificados.map((id) => PedidosGateway.salaEmpleado(id))
      : [PedidosGateway.salaSucursal(sucursalId)];

    // Los duenos siguen enterados (igual que en #2.6): la PWA Admin muestra los
    // pedidos entrantes. Van en la MISMA cadena para no duplicar a quien este en
    // las dos salas (p.ej. un dueno con accesoMultiSucursal).
    this.aSalas([...salas, PedidosGateway.salaDuenos(negocioId)]).emit('pedido:nuevo', cuerpo);
    return cuerpo;
  }

  /** #2.8: alguien tomo el pedido -> avisa a los demas notificados + duenos. */
  emitirPedidoAsignado(
    negocioId: string, sucursalId: string,
    payload: { pedidoId: string; empleadoAsignadoId: string; nombreEmpleado: string; empleadosNotificados: string[] },
  ) {
    const { empleadosNotificados, ...resto } = payload;
    const cuerpo = { ...resto, emitidoEn: new Date().toISOString() };
    const salas = empleadosNotificados.length
      ? empleadosNotificados.map((id) => PedidosGateway.salaEmpleado(id))
      : [PedidosGateway.salaSucursal(sucursalId)];

    // Los duenos van en la misma cadena para no duplicar a quien este en ambas.
    this.aSalas([...salas, PedidosGateway.salaDuenos(negocioId)]).emit('pedido:asignado', cuerpo);
    return cuerpo;
  }

  /**
   * Arma la cadena .to(a).to(b)... de forma dinamica. Se hace asi (y no con
   * this.server.to(a).to(b)) porque la cantidad de salas es variable, y con
   * .emit() separados un socket en dos de las salas recibiria el evento doble.
   */
  private aSalas(salas: string[]) {
    let destino = this.server.to(salas[0]);
    for (let i = 1; i < salas.length; i++) destino = destino.to(salas[i]);
    return destino;
  }

  /** #2.8: check-in / check-out del staff (misma audiencia: la sucursal). */
  emitirCheckin(negocioId: string, sucursalId: string, evento: 'checkin' | 'checkout', payload: Record<string, unknown>) {
    this.server
      .to(PedidosGateway.salaSucursal(sucursalId))
      .to(PedidosGateway.salaDuenos(negocioId))
      .emit(`empleado:${evento}`, { ...payload, emitidoEn: new Date().toISOString() });
  }

  /** Cambio de estado: al pedido y al cliente. */
  emitirEstado(pedidoId: string, clienteId: string | null, payload: Record<string, unknown>) {
    // Encadenado: el cliente suele estar en pedido:{id} Y en cliente:{id};
    // con dos .emit() separados le llegaba el evento DOS veces.
    const destino = this.server.to(PedidosGateway.salaPedido(pedidoId));
    if (clienteId) destino.to(PedidosGateway.salaCliente(clienteId));
    destino.emit('pedido:estado-actualizado', payload);
  }

  /** Cancelado por el cliente: avisa a la sucursal. */
  emitirCancelado(negocioId: string, sucursalId: string, payload: Record<string, unknown>) {
    this.server
      .to(PedidosGateway.salaSucursal(sucursalId))
      .to(PedidosGateway.salaDuenos(negocioId))
      .emit('pedido:cancelado', payload);
  }
}
