import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MigracionSucursalService } from './migracion-sucursal.service';

/**
 * Comando one-shot (standalone, SIN HTTP):
 *
 *   cd apps/backend
 *   node dist/sucursales/migracion-sucursal.command.js            # aplica
 *   node dist/sucursales/migracion-sucursal.command.js --dry-run  # solo diagnostico
 *
 * Es IDEMPOTENTE: correrlo dos veces no duplica nada.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const svc = app.get(MigracionSucursalService);
    if (dryRun) {
      const d = await svc.diagnostico();
      // eslint-disable-next-line no-console
      console.log('[migracion-sucursal] DRY RUN', JSON.stringify(d, null, 2));
    } else {
      const r = await svc.ejecutar();
      // eslint-disable-next-line no-console
      console.log('[migracion-sucursal] RESULTADO', JSON.stringify(r, null, 2));
    }
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[migracion-sucursal] FALLO', e);
  process.exit(1);
});