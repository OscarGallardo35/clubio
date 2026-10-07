import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

/**
 * Contexto de uso del cliente Redis.
 *
 * Cambia SOLO `maxRetriesPerRequest` (y `lazyConnect` en el probe): el resto de la
 * configuracion es la misma para todos.
 *
 * - `app`    -> cliente compartido (`RedisService`): 3 reintentos por request.
 * - `bullmq` -> BullMQ: `null` es OBLIGATORIO (con otro valor el worker lanza al arrancar).
 * - `probe`  -> healthcheck: 1 reintento y sin conectar en el constructor, para que
 *               `/api/health` siempre responda rapido.
 */
export type ContextoRedis = 'app' | 'bullmq' | 'probe';

/** Upstash exige TLS. */
export const esRediss = (raw?: string): boolean => !!raw?.startsWith('rediss://');

/**
 * Opciones de Redis derivadas de `REDIS_URL`.
 *
 * IMPORTANTE: aca NO se setea `retryStrategy`. El default de ioredis reintenta con
 * backoff, y es lo unico que permite recuperarse de un corte transitorio: si
 * `retryStrategy` devuelve un valor no numerico, ioredis deja de reintentar y la
 * conexion queda en `'end'` para siempre hasta que alguien llame `connect()` a mano.
 * Un cliente que sirve a un health probe con esa config miente (ver TROUBLESHOOTING.md).
 */
export function opcionesRedis(raw: string | undefined, contexto: ContextoRedis): RedisOptions {
  const comunes: RedisOptions = {
    // Upstash no responde el ready-check como un Redis local.
    enableReadyCheck: false,
    // ioredis ya activa TLS con el esquema `rediss://`; se declara igual para no
    // depender de ese detalle interno y para que valga si la conexion se arma con
    // host/puerto (BullMQ).
    ...(esRediss(raw) ? { tls: { rejectUnauthorized: false } } : {}),
  };

  if (contexto === 'bullmq') return { ...comunes, maxRetriesPerRequest: null };
  if (contexto === 'probe') {
    return { ...comunes, maxRetriesPerRequest: 1, lazyConnect: true };
  }
  return { ...comunes, maxRetriesPerRequest: 3 };
}

/**
 * Cliente ioredis ya configurado (TLS + ready-check + reintentos por contexto).
 *
 * Absorbe el evento `error`: sin listener, ioredis crashea el proceso.
 */
export function crearClienteRedis(raw: string | undefined, contexto: ContextoRedis): Redis {
  const cliente = new Redis(raw ?? 'redis://localhost:6379', opcionesRedis(raw, contexto));
  cliente.on('error', () => undefined);
  return cliente;
}

/**
 * Opciones de CONEXION para BullMQ.
 *
 * BullMQ no acepta una URL en `connection`: necesita host/puerto/credenciales. Reusa
 * `opcionesRedis(raw, 'bullmq')` para que no existan dos politicas que puedan divergir.
 */
export function conexionBullmq(raw?: string): RedisOptions {
  const comunes = opcionesRedis(raw, 'bullmq');
  if (!raw) return { host: 'localhost', port: 6379, ...comunes };

  const u = new URL(raw);
  const isTls = u.protocol === 'rediss:';
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : isTls ? 6380 : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    ...comunes,
  };
}
