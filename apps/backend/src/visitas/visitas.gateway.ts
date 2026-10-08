import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { COOKIE_CLIENTE, COOKIE_EMPLEADO, leerCookie } from '../common/utils/cookie.util';
import type { VisitaAprobadaPayload } from '@repo/types';

/**
 * WebSocket de visitas (namespace /visitas).
 *
 * Salas (multi-sucursal desde el dia 1):
 *   cliente:{clienteId}                 -> el cliente escucha SU visita
 *   sucursal:{sucursalId}:empleados     -> staff de esa sucursal
 *   negocio:{negocioId}:duenos          -> admin/dueño ve todas las sucursales
 *
 * CORS: se refleja el origen (`origin: true`) porque estas opciones se evaluan
 * al definir la clase, ANTES de que ConfigModule cargue el .env, asi que leer
 * CORS_ORIGINS aca no seria fiable. La autenticacion real es el JWT del
 * handshake, por eso reflejar el origen es seguro.
 *
 * A1 (#3.0): el token del cliente ahora viaja tambien en la cookie HttpOnly, y
 * el navegador NO la manda si el handshake no admite credenciales: por eso el
 * gateway mantiene `credentials: true`. El orden de lectura es auth.token ->
 * ?token= -> Authorization -> cookie.
 */
@WebSocketGateway({ namespace: '/visitas', cors: { origin: true, credentials: true } })
export class VisitasGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('VisitasGateway');

  @WebSocketServer() server!: Server;

  constructor(
    private readonly wsGuard: WsJwtGuard,
    private readonly prisma: PrismaService,
  ) {}

  static salaSucursal(sucursalId: string) { return `sucursal:${sucursalId}:empleados`; }
  static salaDuenos(negocioId: string) { return `negocio:${negocioId}:duenos`; }
  static salaCliente(clienteId: string) { return `cliente:${clienteId}`; }

  private tokenDe(socket: Socket): string {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    if (typeof auth?.token === 'string') return auth.token;
    const q = socket.handshake.query?.token;
    if (typeof q === 'string') return q;
    const h = socket.handshake.headers?.authorization ?? '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    // Cookies HttpOnly. La de EMPLEADO va primero: es la de la PWA Staff, y sin
    // esto el socket del staff solo autenticaba con el token en memoria (que se
    // pierde al recargar), asi que un F5 dejaba de recibir `visita:solicitada`.
    // Un token de cliente nunca pasa por el canal de staff: WsJwtGuard valida el
    // claim `tipo`.
    const deEmpleado = leerCookie(socket.handshake.headers?.cookie, COOKIE_EMPLEADO);
    if (deEmpleado) return deEmpleado;
    // A1 (#3.0): cookie HttpOnly de la PWA Cliente.
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
        await socket.join(VisitasGateway.salaCliente(identidad.clienteId));
      } else {
        // Sala de su propia sucursal
        if (identidad.sucursalId) await socket.join(VisitasGateway.salaSucursal(identidad.sucursalId));

        // accesoMultiSucursal: entra a TODAS las sucursales del negocio
        if (identidad.accesoMultiSucursal) {
          const sucursales = await this.prisma.sucursal.findMany({
            where: { negocioId: identidad.negocioId }, select: { id: true },
          });
          for (const s of sucursales) await socket.join(VisitasGateway.salaSucursal(s.id));
        }
        if (identidad.rol === 'DUENO') await socket.join(VisitasGateway.salaDuenos(identidad.negocioId));
      }

      socket.emit('conectado', { tipo: identidad.tipo, salas: [...socket.rooms] });
    } catch (e) {
      this.logger.warn(`Fallo el handshake: ${(e as Error).message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    socket.data.identidad = undefined;
  }

  /** Emitido cuando un cliente pide sumar su visita: solo a la sucursal destino + dueños. */
  emitirSolicitada(payload: {
    negocioId: string; sucursalId: string; token: string; expiraEn: Date;
    cliente: { id: string; nombre: string; telefonoEnmascarado: string; sellosActuales: number };
    origen?: string;
  }) {
    const cuerpo = { ...payload, emitidoEn: new Date().toISOString() };
    // Encadenado: un dueno con accesoMultiSucursal esta en la sala de sucursal
    // Y en la de duenos; con dos .emit() separados recibia el evento DUPLICADO.
    this.server
      .to(VisitasGateway.salaSucursal(payload.sucursalId))
      .to(VisitasGateway.salaDuenos(payload.negocioId))
      .emit('visita:solicitada', cuerpo);
    return cuerpo;
  }

  /**
   * Payload de `visita:aprobada`, tipado con el MISMO tipo que usa el cliente
   * (`VisitaAprobadaPayload`, @repo/types). El backend lo consume desde `dist` (ver tsconfig:
   * `rootDir: ./src` prohibe imports fuera de src) y el Dockerfile construye @repo/types antes.
   */
  emitirAprobada(clienteId: string, payload: VisitaAprobadaPayload) {
    this.server.to(VisitasGateway.salaCliente(clienteId)).emit('visita:aprobada', payload);
  }

  emitirRechazada(clienteId: string, payload: Record<string, unknown>) {
    this.server.to(VisitasGateway.salaCliente(clienteId)).emit('visita:rechazada', payload);
  }
}
