import { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';

/**
 * Candado de CUOTA (no de performance) para los workers de BullMQ.
 *
 * Contrato de estas constantes y del helper, para que las dos colas se comporten
 * igual y no aparezcan numeros magicos duplicados.
 *
 * Cuanto se pausa la cola cuando Redis falla (cuota agotada, corte del
 * proveedor) y hay que dejar de reintentar en loop. Ver TROUBLESHOOTING.
 */
export const PAUSA_POR_REDIS_MS = 5 * 60_000;

/**
 * Cada cuanto un worker OCIOSO re-sondea su cola (BullMQ `drainDelay`).
 *
 * NO agrega latencia a los jobs: BullMQ deja un `marker` (ZADD) en la cola al
 * encolar un job (`addBaseMarkerIfNeeded` en `commands/includes/`) y un job
 * demorado tambien lo señaliza; el worker bloqueado en `bzpopmin(marker)` se
 * despierta al instante. `drainDelay` es solo el timeout de ese bloqueo cuando
 * NO hay nada para procesar. Verificado en bullmq@5.81.5 (`worker.js`
 * `getBlockTimeout`: con `blockUntil` falsy devuelve `max(drainDelay,
 * minimumBlockTimeout)`, o sea el timeout del `bzpopmin` del marker). Subirlo de
 * 30s a 300s baja el piso ocioso de comandos (Root: ~17.3k/dia = 518k/mes = 104%
 * del plan Free, SIN procesar un solo job) sin cambiar la latencia del envio.
 */
export const CHEQUEO_DEMORADOS_S = 300;

/**
 * Cada cuanto BullMQ revisa jobs TRABADOS (stalled) y los reencola.
 *
 * OJO: `stalledInterval` esta en MILISEGUNDOS (el default de BullMQ es 30000
 * = 30s; ver worker.js: "then every opts.stalledInterval milliseconds" y
 * `setTimeout(resolve, this.opts.stalledInterval)`). Se sube a 300_000 ms (5 min):
 * un job realmente colgado tarda hasta 5 min mas en recuperarse, aceptable para
 * envios push, y cada chequeo de stalled es un comando (Lua) contra Redis.
 *
 * Footgun medido: pasar 300 (creyendo que era 300s) deja el chequeo en 300 ms y
 * MULTIPLICA el trafico (~20x) en vez de bajarlo: el worker corre el script de
 * stalled 3.3 veces por segundo.
 */
export const INTERVALO_STALLED_MS = 5 * 60_000;

/** Estado del candado por cola: mientras exista el timer, la cola ya esta pausada. */
export interface EstadoCandado {
  reanudarEn?: NodeJS.Timeout;
}

/**
 * Si Redis falla (cuota agotada, corte del proveedor) el worker de BullMQ
 * reintenta en loop y CADA intento es un comando: es la forma mas rapida de
 * quemar la cuota. En vez de eso se pausa la cola y se reanuda sola unos minutos
 * despues, con el error logueado UNA vez por pausa (no en loop).
 *
 * Mismo candado para las dos colas: si Redis falla, fallan las dos.
 */
export async function pausarColaPorRedis(
  worker: Worker,
  logger: Logger,
  nombreCola: string,
  estado: EstadoCandado,
  err: Error,
): Promise<void> {
  if (estado.reanudarEn) return; // ya esta pausada: no reprogramar en cada reintento
  logger.error(
    `Redis fallo; la cola ${nombreCola} se pausa ${PAUSA_POR_REDIS_MS / 60_000} min: ${err.message}`,
  );
  try {
    await worker.pause();
  } catch {
    // Si no se pudo pausar, igual se reprograma: peor es dejarla reintentando sin freno.
  }
  estado.reanudarEn = setTimeout(() => {
    estado.reanudarEn = undefined;
    try {
      void worker.resume();
      logger.log(`Cola ${nombreCola} reanudada`);
    } catch (e) {
      logger.error(`No se pudo reanudar ${nombreCola}: ${(e as Error).message}`);
    }
  }, PAUSA_POR_REDIS_MS);
  estado.reanudarEn.unref?.();
}
