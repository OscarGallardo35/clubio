
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EstadoPedido } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { PedidosService } from './pedidos.service';

/**
 * Tareas de mantenimiento de pedidos. Cada una se aisla con try/catch para que
 * el fallo de una no impida las otras.
 */
@Injectable()
export class PedidosScheduler {
  private readonly logger = new Logger('PedidosScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly pedidos: PedidosService,
  ) {}

  /** 4 AM: borra pedidos CANCELADO/RECHAZADO con mas de 30 dias. */
  @Cron('0 4 * * *', { name: 'pedidos-antiguos' })
  async limpiarPedidosAntiguos() {
    try {
      const corte = new Date(Date.now() - 30 * 86_400_000);
      const r = await this.prisma.pedido.deleteMany({
        where: {
          estado: { in: [EstadoPedido.CANCELADO, EstadoPedido.RECHAZADO] },
          creadoEn: { lt: corte },
        },
      });
      if (r.count) this.logger.log(`Pedidos cerrados eliminados (>30 dias): ${r.count}`);
    } catch (e) {
      this.logger.error(`limpiarPedidosAntiguos fallo: ${(e as Error).message}`);
    }
  }

  /**
   * 5 AM: libera el linkToken de los pedidos cuyo link vencio hace mas de 7 dias.
   * El pedido NO se borra, solo se le quita el link para no acumular tokens.
   */
  @Cron('0 5 * * *', { name: 'pedidos-links' })
  async limpiarLinksExpirados() {
    try {
      const corte = new Date(Date.now() - 7 * 86_400_000);
      const r = await this.prisma.pedido.updateMany({
        where: { linkExpiraEn: { lt: corte }, linkToken: { not: null } },
        data: { linkToken: null, linkExpiraEn: null },
      });
      if (r.count) this.logger.log(`Links de pedido liberados: ${r.count}`);
    } catch (e) {
      this.logger.error(`limpiarLinksExpirados fallo: ${(e as Error).message}`);
    }
  }

  /** Cada 15 min: recordatorio al staff por pedidos trabados. */
  @Cron('*/15 * * * *', { name: 'pedidos-recordatorio' })
  async recordarPedidosTrabados() {
    try {
      const ahora = Date.now();
      const [pendientes, confirmados] = await Promise.all([
        this.prisma.pedido.findMany({
          where: { estado: EstadoPedido.PENDIENTE, creadoEn: { lt: new Date(ahora - 10 * 60_000) } },
          select: { id: true, negocioId: true, sucursalId: true, nombreCliente: true },
          take: 50,
        }),
        this.prisma.pedido.findMany({
          where: {
            estado: EstadoPedido.CONFIRMADO,
            confirmadoEn: { lt: new Date(ahora - 30 * 60_000) },
          },
          select: { id: true, negocioId: true, sucursalId: true, nombreCliente: true },
          take: 50,
        }),
      ]);

      for (const p of pendientes) {
        await this.push.enviarAEmpleadosDelNegocio(
          p.negocioId,
          { title: 'Pedido sin confirmar', body: `${p.nombreCliente} espera hace mas de 10 min`, url: '/pedidos', tag: `pedido-${p.id}` },
          p.sucursalId,
        ).catch(() => undefined);
      }
      for (const p of confirmados) {
        await this.push.enviarAEmpleadosDelNegocio(
          p.negocioId,
          { title: 'Pedido demorado', body: `${p.nombreCliente}: confirmado hace mas de 30 min y sigue sin prepararse`, url: '/pedidos', tag: `pedido-${p.id}` },
          p.sucursalId,
        ).catch(() => undefined);
      }
      if (pendientes.length + confirmados.length) {
        this.logger.warn(`Recordatorios enviados: ${pendientes.length} pendientes, ${confirmados.length} demorados`);
      }
    } catch (e) {
      this.logger.error(`recordarPedidosTrabados fallo: ${(e as Error).message}`);
    }
  }

  /**
   * Cada hora: auto-cancela los pedidos PENDIENTE abandonados (> 6 h sin que el local confirme).
   *
   * La logica vive en el servicio (`autoCancelarPendientesAbandonados`) por el mismo criterio que
   * los crons del #2.9: asi se puede invocar con un `ahora` cualquiera sin esperar a la hora en
   * punto (lo hace `test:auto-cancelar` a traves del endpoint de mantenimiento).
   */
  @Cron('0 * * * *', { name: 'pedidos-auto-cancelar' })
  async autoCancelarAbandonados() {
    try {
      await this.pedidos.autoCancelarPendientesAbandonados();
    } catch (e) {
      this.logger.error(`autoCancelarAbandonados fallo: ${(e as Error).message}`);
    }
  }
}
