import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Ejecuta el callback dentro de una transaccion con el tenant seteado.
   * RLS lee `app.current_negocio_id` (falla cerrado si no esta seteado).
   * En la Fase 2 se reemplaza por AsyncLocalStorage + withTenant global.
   */
  async withTenant<T>(negocioId: string, callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_negocio_id', ${negocioId}, true)`;
      return callback(tx as unknown as PrismaClient);
    });
  }
}
