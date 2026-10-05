import { Global, Module } from '@nestjs/common';
import { SucursalResolverService } from './sucursal-resolver.service';

@Global()
@Module({
  providers: [SucursalResolverService],
  exports: [SucursalResolverService],
})
export class SucursalesModule {}
