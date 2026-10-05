import { Module } from '@nestjs/common';
import { NegociosService } from './negocios.service';
import { NegociosController } from './negocios.controller';
import { ConfiguracionModule } from '../configuracion/configuracion.module';

/**
 * ConfiguracionModule se importa para que publicoPorSlug pueda devolver la config
 * EFECTIVA de una sucursal (global + override), delegando el merge.
 */
@Module({
  imports: [ConfiguracionModule],
  controllers: [NegociosController],
  providers: [NegociosService],
  exports: [NegociosService],
})
export class NegociosModule {}