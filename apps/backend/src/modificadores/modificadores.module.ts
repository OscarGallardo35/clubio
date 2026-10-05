import { Module } from '@nestjs/common';
import { ModificadoresService } from './modificadores.service';
import { AsignacionService } from './asignacion.service';
import { ModificadoresController } from './modificadores.controller';

@Module({
  controllers: [ModificadoresController],
  providers: [ModificadoresService, AsignacionService],
  exports: [ModificadoresService, AsignacionService],
})
export class ModificadoresModule {}