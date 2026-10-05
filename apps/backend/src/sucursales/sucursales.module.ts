import { Global, Module } from '@nestjs/common';
import { SucursalResolverService } from './sucursal-resolver.service';
import { SucursalesService } from './sucursales.service';
import { SucursalesController } from './sucursales.controller';
import { ConfiguracionSucursalService } from './configuracion-sucursal.service';
import { ConfiguracionSucursalController } from './configuracion-sucursal.controller';
import { ItemCartaSucursalService } from './item-carta-sucursal.service';
import { ItemCartaSucursalController } from './item-carta-sucursal.controller';
import { MigracionSucursalService } from './migracion-sucursal.service';
import { SucursalesScheduler } from './sucursales.scheduler';
import { ConfiguracionModule } from '../configuracion/configuracion.module';

/**
 * @Global() por el SucursalResolverService (lo usan casi todos los modulos).
 * ConfiguracionModule se importa para delegar el MERGE en configEfectiva.
 */
@Global()
@Module({
  imports: [ConfiguracionModule],
  controllers: [
    SucursalesController,
    ConfiguracionSucursalController,
    ItemCartaSucursalController,
  ],
  providers: [
    SucursalResolverService,
    SucursalesService,
    ConfiguracionSucursalService,
    ItemCartaSucursalService,
    MigracionSucursalService,
    SucursalesScheduler,
  ],
  exports: [SucursalResolverService, SucursalesService, MigracionSucursalService],
})
export class SucursalesModule {}