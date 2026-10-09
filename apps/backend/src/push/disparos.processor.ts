import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { COLA_DISPAROS, DIA_TICK_MIN, DisparosService } from './disparos.service';

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
  // Igual criterio que la cola de push: no reaccionar al segundo (cada vuelta es
  // un comando contra Redis).
  drainDelay: 30,
})
export class DisparosProcessor extends WorkerHost {
  private readonly logger = new Logger('DisparosProcessor');

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

  @OnWorkerEvent('error')
  alFallarRedis(err: Error) {
    this.logger.error(`Worker ${COLA_DISPAROS} con error: ${err.message}`);
  }

  async process(job: Job) {
    if (job.name === 'dia') return this.disparos.evaluarDia();
    if (job.name === 'inactividad') return this.disparos.evaluarInactividad();
    return { ignorado: job.name };
  }
}
