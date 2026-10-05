import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

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
 * handshake (no hay cookies), por eso reflejar el origen es seguro.
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
    return h.startsWith('Bearer ') ? h.slice(7) : '';
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

  emitirAprobada(clienteId: string, payload: Record<string, unknown>) {
    this.server.to(VisitasGateway.salaCliente(clienteId)).emit('visita:aprobada', payload);
  }

  emitirRechazada(clienteId: string, payload: Record<string, unknown>) {
    this.server.to(VisitasGateway.salaCliente(clienteId)).emit('visita:rechazada', payload);
  }
}
