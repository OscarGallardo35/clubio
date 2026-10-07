import { Controller, Get } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { crearClienteRedis } from '../common/redis/redis-cliente.util';
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
    // `probe`: 1 reintento por request y sin conectar en el constructor (lazyConnect).
    // NO se deshabilita `retryStrategy`: un cliente sin reintentos queda en 'end' para
    // siempre tras el primer fallo, y este endpoint mentiria para siempre (TROUBLESHOOTING).
    this.redis = crearClienteRedis(process.env.REDIS_URL, 'probe');
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
      // 'wait' -> lazyConnect: todavia no se intento conectar.
      // 'end' / 'close' -> la conexion se corto: hay que forzar el connect, porque
      // ioredis no vuelve solo desde esos estados.
      const estado = this.redis.status;
      if (estado === 'wait' || estado === 'end' || estado === 'close') {
        await this.redis.connect().catch(() => undefined);
      }
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
