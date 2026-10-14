import { Module } from '@nestjs/common';
import { HorariosService } from './horarios.service';
import { HorariosController } from './horarios.controller';
import { ConfiguracionModule } from '../configuracion/configuracion.module';

/**
 * Horarios del local (atencion / delivery) + excepciones (feriados, cierre temporal).
 *
 * ConfiguracionModule aporta la grilla EFECTIVA (global + override de sucursal) con su
 * cache. HorariosModule no importa PushModule: el helper puro importa las funciones de
 * hora argentina del archivo de `push/disparos.service` (no del modulo), asi no hay ciclo.
 */
@Module({
  imports: [ConfiguracionModule],
  controllers: [HorariosController],
  providers: [HorariosService],
  exports: [HorariosService],
})
export class HorariosModule {}
