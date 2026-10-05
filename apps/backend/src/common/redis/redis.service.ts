import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Cliente Redis compartido (Upstash en prod/local). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      // Upstash requiere TLS si la URL es rediss://
      ...(process.env.REDIS_URL?.startsWith('rediss://')
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    });
    // ioredis sin listener de 'error' crashea el proceso.
    this.client.on('error', () => undefined);
  }

  /** Incrementa y setea TTL (segundos) solo en la primera creacion. */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Borra TODAS las claves que matcheen un patron, con SCAN (nunca KEYS: bloquea
   * el server entero y en Upstash ademas puede no estar permitido).
   *
   * Hace falta de verdad: `sucursal:resolve:{negocioId}:{hash}` termina en un hash
   * que depende de los parametros de la request, asi que no se puede reconstruir
   * la clave para borrarla.
   */
  async delByPattern(pattern: string): Promise<number> {
    let borradas = 0;
    const stream = this.client.scanStream({ match: pattern, count: 200 });
    for await (const keys of stream) {
      if (keys.length) borradas += await this.client.del(...keys);
    }
    return borradas;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
