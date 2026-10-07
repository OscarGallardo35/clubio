import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from './prisma/prisma.module';
import { JwtGlobalModule } from './common/auth/jwt-global.module';
import { RedisModule } from './common/redis/redis.module';
import { conexionBullmq } from './common/redis/redis-cliente.util';
import { AuditoriaModule } from './common/auditoria/auditoria.module';
import { mensajeDeThrottle } from './common/constants/throttle-messages';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { SucursalesModule } from './sucursales/sucursales.module';
import { NegociosModule } from './negocios/negocios.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ClientesModule } from './clientes/clientes.module';
import { EmpleadosModule } from './empleados/empleados.module';
import { VisitasModule } from './visitas/visitas.module';
// WebhooksModule es @Global (lo usan Google y futuros webhooks)
import { CartaModule } from './carta/carta.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { ModificadoresModule } from './modificadores/modificadores.module';
import { UpsellModule } from './upsell/upsell.module';
import { TurnosModule } from './turnos/turnos.module';
import { PlanesModule } from './planes/planes.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PushModule } from './push/push.module';
import { GoogleModule } from './google/google.module';
import { ResenasModule } from './resenas/resenas.module';
import { EstadisticasModule } from './estadisticas/estadisticas.module';

@Module({
  imports: [
    // Fuente UNICA de verdad del entorno: /.env en la raiz del monorepo.
    // El cwd del backend es apps/backend, por eso '../../'.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      // Forma objeto (no array): es la unica que admite `errorMessage`.
      throttlers: [{ ttl: 60_000, limit: 100 }],
      errorMessage: mensajeDeThrottle,
    }),
    BullModule.forRoot({ connection: conexionBullmq(process.env.REDIS_URL) }),
    PrismaModule,
    JwtGlobalModule,
    RedisModule,
    AuditoriaModule,
    SucursalesModule,
    HealthModule,
    AuthModule,
    // --- Lote 3: core negocio ---
    NegociosModule,
    ConfiguracionModule,
    ClientesModule,
    EmpleadosModule,
    // --- Lote 4: fidelizacion + carta ---
    VisitasModule,
    CartaModule,
    // --- Fase 2: pedidos + modificadores + upsell ---
    PedidosModule,
    ModificadoresModule,
    UpsellModule,
    TurnosModule,
    PlanesModule,
    // --- Lote 5: soporte ---
    WebhooksModule,
    PushModule,
    GoogleModule,
    ResenasModule,
    EstadisticasModule,
  ],
  providers: [
    // Rate limiting global. Los JWT guards NO se registran globalmente:
    // se aplican por controlador a partir del Lote 2 (cuando existan las estrategias).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
