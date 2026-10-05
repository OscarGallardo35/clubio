import { Module } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClientesController } from './clientes.controller';
import { SegmentosService } from './segmentos.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, SegmentosService],
  exports: [ClientesService, SegmentosService],
})
export class ClientesModule {}
