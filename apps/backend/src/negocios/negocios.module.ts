import { Module } from '@nestjs/common';
import { NegociosService } from './negocios.service';
import { NegociosController } from './negocios.controller';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { HorariosModule } from '../horarios/horarios.module';

/**
 * ConfiguracionModule se importa para que publicoPorSlug pueda devolver la config
 * EFECTIVA de una sucursal (global + override), delegando el merge.
 * HorariosModule aporta las excepciones (feriados/cierres) que viajan al cliente para
 * que calcule "abierto" con Intl sin polling.
 */
@Module({
  imports: [ConfiguracionModule, HorariosModule],
  controllers: [NegociosController],
  providers: [NegociosService],
  exports: [NegociosService],
})
export class NegociosModule {}