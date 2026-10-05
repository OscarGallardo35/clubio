import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

/**
 * Convierte REDIS_URL en opciones de ioredis.
 * Soporta Upstash: `rediss://` (TLS) + las opciones que BullMQ exige.
 */
function redisConnectionFromUrl(raw?: string) {
  // maxRetriesPerRequest: null  -> requerido por BullMQ (si no, lanza al arrancar)
  // enableReadyCheck: false     -> evita el ready-check que falla contra Upstash
  const required = { maxRetriesPerRequest: null as null, enableReadyCheck: false };
  if (!raw) return { host: 'localhost', port: 6379, ...required };

  const u = new URL(raw);
  const isTls = u.protocol === 'rediss:';
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : isTls ? 6380 : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    ...required,
    // Upstash requiere TLS
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  };
}

@Module({
  imports: [
    // Fuente UNICA de verdad del entorno: /.env en la raiz del monorepo.
    // El cwd del backend es apps/backend, por eso '../../'.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    BullModule.forRoot({ connection: redisConnectionFromUrl(process.env.REDIS_URL) }),
    PrismaModule,
    HealthModule,
    // Los modulos de features se agregan por lote (Lote 2..5)
  ],
  providers: [
    // Rate limiting global. Los JWT guards NO se registran globalmente:
    // se aplican por controlador a partir del Lote 2 (cuando existan las estrategias).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
