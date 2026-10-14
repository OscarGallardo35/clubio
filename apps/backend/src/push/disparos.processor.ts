import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { COLA_DISPAROS, DIA_TICK_MIN, DisparosService } from './disparos.service';
import {
  CHEQUEO_DEMORADOS_S,
  INTERVALO_STALLED_MS,
  pausarColaPorRedis,
} from './worker-redis-guard';
import type { EstadoCandado } from './worker-redis-guard';

/** Zona horaria de los negocios: los `hora` de los disparos DIA se leen en AR. */
const TZ_AR = 'America/Argentina/Buenos_Aires';

/**
 * Procesador de los jobs de tiempo de los DisparoPush.
 *
 * Los jobs son REPEATABLE de BullMQ con un `jobSchedulerId` fijo: `upsertJobScheduler`
 * garantiza uno solo por id (no se duplican aunque el contenedor reinicie). El
 * `tz` es Argentina para que el patron del cron y la ventana horaria del motor
 * queden en hora local y no a las 3 de la mañana.
 */
@Processor(COLA_DISPAROS, {
  concurrency: 1,
  // Igual criterio que la cola de push (ver worker-redis-guard.ts): no reaccionar
  // al segundo, porque cada vuelta del worker es un comando contra Redis. NO
  // retrasa los jobs: BullMQ los señaliza por el `marker`.
  drainDelay: CHEQUEO_DEMORADOS_S,
  // 300_000 ms = 5 min (default 30000 ms): un job trabado tarda hasta 5 min mas en
  // recuperarse. OJO: va en MILISEGUNDOS.
  stalledInterval: INTERVALO_STALLED_MS,
})
export class DisparosProcessor extends WorkerHost {
  private readonly logger = new Logger('DisparosProcessor');
  /** Estado del candado de cuota (ver worker-redis-guard.ts). */
  private readonly candado: EstadoCandado = {};

  constructor(
    private readonly disparos: DisparosService,
    @InjectQueue(COLA_DISPAROS) private readonly cola: Queue,
  ) {
    super();
  }

  /** Registra los schedulers repeatable al arrancar (idempotente). */
  async onModuleInit() {
    try {
      await this.cola.upsertJobScheduler(
        'disparos-dia',
        { pattern: `*/${DIA_TICK_MIN} * * * *`, tz: TZ_AR },
        { name: 'dia', opts: { removeOnComplete: 50, removeOnFail: 100 } },
      );
      await this.cola.upsertJobScheduler(
        'disparos-inactividad',
        { pattern: '0 10 * * *', tz: TZ_AR },
        { name: 'inactividad', opts: { removeOnComplete: 50, removeOnFail: 100 } },
      );
      this.logger.log(
        `Schedulers de disparos registrados: dia cada ${DIA_TICK_MIN} min, inactividad diaria 10:00 AR`,
      );
    } catch (e) {
      this.logger.error(`No se pudieron registrar los schedulers de disparos: ${(e as Error).message}`);
    }
  }

  /**
   * Mismo candado de cuota que la cola de push: si Redis falla, la cola de
   * disparos se pausa y se reanuda sola (antes esto solo logueaba y el worker
   * seguia reintentando en loop, quemando cuota). Ver worker-redis-guard.ts.
   */
  @OnWorkerEvent('error')
  async alFallarRedis(err: Error) {
    await pausarColaPorRedis(this.worker, this.logger, COLA_DISPAROS, this.candado, err);
  }

  async process(job: Job) {
    if (job.name === 'dia') return this.disparos.evaluarDia();
    if (job.name === 'inactividad') return this.disparos.evaluarInactividad();
    return { ignorado: job.name };
  }
}
