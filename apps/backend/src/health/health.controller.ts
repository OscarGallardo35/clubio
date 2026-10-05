import { Controller, Get } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Healthcheck para Railway.
 * Diseno tolerante: devuelve 200 si la DB responde, e informa Redis aparte.
 * Asi el deploy no se reinicia por un Redis momentaneamente caido.
 */
@Controller('health')
export class HealthController {
  private readonly redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      // No reintentar: si no hay Redis, se reporta 'down' y listo.
      retryStrategy: () => null,
    });
    // ioredis emite 'error' sin listener -> crashea el proceso. Lo absorbemos:
    // el estado real se reporta por el campo `redis` de este endpoint.
    this.redis.on('error', () => undefined);
  }

  @Get()
  @Public()
  async check() {
    const db = await this.checkDb();
    const redis = await this.checkRedis();
    return {
      status: db === 'up' ? 'ok' : 'error',
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
