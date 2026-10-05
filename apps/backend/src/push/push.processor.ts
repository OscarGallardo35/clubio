import { Processor, WorkerHost } from '@nestjs/bullmq';
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
 * Procesador de la cola "push-send".
 *
 * Corre en background: la API solo encola y responde. Concurrency 5 para no
 * saturar al proveedor de push. Los 404/410 significan que el navegador revoco
 * la suscripcion: se desactiva y NO se reintenta (es un fallo permanente).
 */
@Processor(COLA_PUSH, {
  concurrency: 5,
  settings: { backoffStrategy: (attemptsMade: number) => backoffEscalonado(attemptsMade) },
})
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger('PushProcessor');

  constructor(private readonly push: PushService) {
    super();
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