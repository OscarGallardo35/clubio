import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { TurnosService } from './turnos.service';
import { CheckinService } from './checkin.service';
import { fechaSoloDia, hoy } from './helpers/horarios';

/**
 * Los 4 crons del #2.8. Cada uno aislado con try/catch: si uno falla, no tumba
 * a los demas ni al scheduler.
 */
@Injectable()
export class TurnosScheduler {
  private readonly logger = new Logger('TurnosScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly turnos: TurnosService,
    private readonly checkin: CheckinService,
    private readonly push: PushService,
  ) {}

  /** Medianoche: transicion del encargado del dia nuevo. */
  @Cron('0 0 * * *', { name: 'turnos-transicion-encargado' })
  async transicionEncargado() {
    try {
      const r = await this.turnos.transicionEncargado(hoy());
      if (r.creados) this.logger.log(`Encargado del dia creado en ${r.creados} sucursal(es)`);
    } catch (e) {
      this.logger.error(`transicionEncargado fallo: ${(e as Error).message}`);
    }
  }

  /** 23:59: cierra check-ins huerfanos. */
  @Cron('59 23 * * *', { name: 'turnos-cierre-checkins' })
  async cerrarCheckins() {
    try {
      const r = await this.checkin.cerrarHuerfanos();
      if (r.cerrados) this.logger.log(`Check-ins cerrados automaticamente: ${r.cerrados}`);
    } catch (e) {
      this.logger.error(`cerrarCheckins fallo: ${(e as Error).message}`);
    }
  }

  /** 8 AM: recordatorio de los turnos de hoy (solo si turnosActivos). */
  @Cron('0 8 * * *', { name: 'turnos-recordatorio' })
  async recordarTurnosDelDia() {
    try {
      const dia = fechaSoloDia(hoy());
      const turnos = await this.prisma.turno.findMany({
        where: { fecha: dia },
        include: {
          empleado: { select: { id: true, nombre: true, activo: true, eliminadoEn: true } },
          negocio: { select: { id: true, configuracion: { select: { turnosActivos: true } } } },
        },
      });

      const porEmpleado = new Map<string, { negocioId: string; todos: typeof turnos }>();
      for (const t of turnos) {
        if (!t.empleado.activo || t.empleado.eliminadoEn) continue;
        if (!t.negocio.configuracion?.turnosActivos) continue; // refinamiento 5
        const k = `${t.negocioId}:${t.empleadoId}`;
        const previo = porEmpleado.get(k) ?? { negocioId: t.negocioId, todos: [] as typeof turnos };
        previo.todos.push(t);
        porEmpleado.set(k, previo);
      }

      let enviados = 0;
      for (const [k, v] of porEmpleado) {
        const empleadoId = k.split(':')[1];
        const detalle = v.todos
          .map((t) => `${t.horaInicio} a ${t.horaFin} como ${t.tipoTurno}`)
          .join(' y ');
        // Push INDIVIDUAL a cada empleado con turno hoy (refinamiento 5)
        await this.push.enviarAEmpleado(v.negocioId, empleadoId, {
          title: 'Hoy tenes turno',
          body: `Hoy tenes turno de ${detalle}.`,
          url: '/turnos', tag: 'turno-hoy',
        }).catch(() => undefined);
        enviados++;
      }
      if (enviados) this.logger.log(`Recordatorios de turno enviados: ${enviados}`);
    } catch (e) {
      this.logger.error(`recordarTurnosDelDia fallo: ${(e as Error).message}`);
    }
  }

  /**
   * Lunes 6 AM: si duplicarSemanaAuto=true y la semana siguiente NO tiene
   * turnos, copia la actual y avisa al dueno. Si ya tiene, NO toca nada.
   */
  @Cron('0 6 * * 1', { name: 'turnos-duplicar-semana' })
  async duplicarSemanaAuto() {
    try {
      const { resultado } = await this.turnos.duplicarSemanaAutomatica();
      for (const r of resultado) {
        if (!r.copiados) {
          this.logger.log(`${r.nombre}: ${r.motivo}`);
          continue;
        }
        const dueno = await this.prisma.empleado.findFirst({
          where: { negocioId: r.negocioId, rol: 'DUENO', activo: true, eliminadoEn: null },
          select: { id: true },
        });
        if (dueno) {
          await this.push.enviarAEmpleado(r.negocioId, dueno.id, {
            title: 'Turnos duplicados',
            body: 'Se copiaron los turnos de esta semana a la proxima. Podes editarlos.',
            url: '/turnos', tag: 'turnos-duplicados',
          }).catch(() => undefined);
        }
        this.logger.log(`${r.nombre}: ${r.copiados} turno(s) copiados`);
      }
    } catch (e) {
      this.logger.error(`duplicarSemanaAuto fallo: ${(e as Error).message}`);
    }
  }
}
