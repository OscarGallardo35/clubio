import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Automatizaciones por tiempo. Cada job se aisla con try/catch: si uno falla,
 * no debe tumbar el scheduler ni impedir los demas.
 */
@Injectable()
export class PushScheduler {
  private readonly logger = new Logger('PushScheduler');

  constructor(private readonly prisma: PrismaService) {}

  /** Cada dia a las 03:00: limpia tokens de validacion vencidos. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'limpiar-tokens' })
  async limpiarTokensVencidos() {
    try {
      const r = await this.prisma.tokenValidacion.deleteMany({
        where: { expiraEn: { lt: new Date(Date.now() - 86_400_000) } },
      });
      if (r.count) this.logger.log(`Tokens de validacion eliminados: ${r.count}`);
    } catch (e) {
      this.logger.error(`limpiarTokensVencidos fallo: ${(e as Error).message}`);
    }
  }

  /** Cada dia a las 04:00: desactiva suscripciones push sin uso por 90 dias. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'push-inactivas' })
  async desactivarPushInactivas() {
    try {
      const corte = new Date(Date.now() - 90 * 86_400_000);
      const [c, e] = await Promise.all([
        this.prisma.notificacionPush.updateMany({ where: { activa: true, ultimoUso: { lt: corte } }, data: { activa: false } }),
        this.prisma.notificacionPushEmpleado.updateMany({ where: { activa: true, ultimoUso: { lt: corte } }, data: { activa: false } }),
      ]);
      if (c.count + e.count) this.logger.log(`Suscripciones push desactivadas por inactividad: ${c.count + e.count}`);
    } catch (err) {
      this.logger.error(`desactivarPushInactivas fallo: ${(err as Error).message}`);
    }
  }

  /** Cada 6 horas: reintenta reseñas de Google cuya integracion quedo en ERROR. */
  @Cron('0 0 */6 * * *', { name: 'google-reintento' })
  async reintentarGoogle() {
    try {
      const pendientes = await this.prisma.integracionGoogle.count({ where: { estado: 'ERROR' } });
      if (pendientes) this.logger.warn(`Integraciones de Google en ERROR: ${pendientes} (reintento manual requerido)`);
    } catch (e) {
      this.logger.error(`reintentarGoogle fallo: ${(e as Error).message}`);
    }
  }
}