import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PushService, COLA_PUSH } from './push.service';
import type { PushJob } from './push.service';

/** 5s, 30s, 5min. BullMQ pasa attemptsMade=1 en el primer fallo. */
function backoffEscalonado(attemptsMade: number) {
  const escalones = [5_000, 30_000, 300_000];
  return escalones[Math.min(Math.max(attemptsMade, 1), escalones.length) - 1];
}

/**
 * Cuanto se pausa la cola cuando Redis falla, y cada cuanto chequea BullMQ los jobs demorados.
 *
 * Esto no es performance: es cuota. Cada chequeo del worker es un comando que cuenta en Upstash, y
 * con el proveedor rechazando (cuota agotada) el worker reintenta en loop: asi se quemo la cuota una
 * vez. Ver TROUBLESHOOTING.
 */
const PAUSA_POR_REDIS_MS = 5 * 60_000;
const CHEQUEO_DEMORADOS_S = 30;

/**
 * Procesador de la cola "push-send".
 *
 * Corre en background: la API solo encola y responde. Concurrency 5 para no
 * saturar al proveedor de push. Los 404/410 significan que el navegador revoco
 * la suscripcion: se desactiva y NO se reintenta (es un fallo permanente).
 */
@Processor(COLA_PUSH, {
  concurrency: 5,
  // 30s en vez de los 5s por defecto: la cola solo mira sus jobs demorados, no necesita reaccionar
  // al segundo, y cada vuelta del worker es un comando contra Redis.
  drainDelay: CHEQUEO_DEMORADOS_S,
  settings: { backoffStrategy: (attemptsMade: number) => backoffEscalonado(attemptsMade) },
})
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger('PushProcessor');
  /** Timer del resume diferido: mientras exista, la cola ya esta pausada. */
  private reanudarEn?: NodeJS.Timeout;

  constructor(private readonly push: PushService) {
    super();
  }

  /**
   * Si Redis falla (cuota agotada, corte del proveedor) el worker de BullMQ reintenta en loop y CADA
   * intento es un comando: es la forma mas rapida de quemar la cuota. En vez de eso se pausa la cola y
   * se reanuda sola unos minutos despues, con el error logueado UNA vez por pausa (no en loop).
   */
  @OnWorkerEvent('error')
  async alFallarRedis(err: Error) {
    if (this.reanudarEn) return; // ya esta pausada: no reprogramar en cada reintento
    this.logger.error(
      `Redis fallo; la cola ${COLA_PUSH} se pausa ${PAUSA_POR_REDIS_MS / 60_000} min: ${err.message}`,
    );
    try {
      await this.worker.pause();
    } catch {
      // Si no se pudo pausar, igual se reprograma: peor es dejarla reintentando sin freno.
    }
    this.reanudarEn = setTimeout(() => {
      this.reanudarEn = undefined;
      try {
        void this.worker.resume();
        this.logger.log(`Cola ${COLA_PUSH} reanudada`);
      } catch (e) {
        this.logger.error(`No se pudo reanudar ${COLA_PUSH}: ${(e as Error).message}`);
      }
    }, PAUSA_POR_REDIS_MS);
    this.reanudarEn.unref?.();
  }

  async process(job: Job<PushJob>) {
    const { negocioId, destino, id, titulo, cuerpo, url } = job.data;

    const suscripciones = await this.push.suscripcionesDe(destino, id);
    if (!suscripciones.length) {
      return { enviados: 0, total: 0, motivo: 'sin suscripciones activas' };
    }

    let enviados = 0;
    const errores: Array<{ id: string; status?: number; message: string }> = [];

    for (const s of suscripciones) {
      try {
        await this.push.enviarAPayload(s, {
          title: titulo,
          body: cuerpo,
          url,
          timestamp: Date.now(),
        });
        enviados++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const message = (e as Error).message ?? 'error desconocido';

        if (status === 404 || status === 410) {
          // Suscripcion revocada por el navegador: permanente, no se reintenta.
          await this.push.desactivarSuscripcion(destino as 'cliente' | 'empleado', s.id);
          this.logger.warn(`Suscripcion ${s.id} revocada (${status}); desactivada`);
          continue;
        }
        errores.push({ id: s.id, status, message });
      }
    }

    await this.push.registrarResultado(negocioId, errores.length === 0, {
      jobId: job.id,
      destino,
      destinatario: id,
      enviados,
      total: suscripciones.length,
      ...(errores.length ? { errores: errores.slice(0, 5) } : {}),
    });

    // Si hubo errores transitorios, se lanza para que BullMQ reintente con backoff.
    if (errores.length) {
      throw new Error(`Fallo el envio a ${errores.length}/${suscripciones.length} suscripcion(es)`);
    }

    return { enviados, total: suscripciones.length };
  }
}