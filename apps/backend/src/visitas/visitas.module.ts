import { Module } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { VisitasController } from './visitas.controller';
import { VisitasGateway } from './visitas.gateway';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [ClientesModule], // aporta SegmentosService
  controllers: [VisitasController],
  providers: [VisitasService, VisitasGateway, WsJwtGuard],
  exports: [VisitasService, VisitasGateway],
})
export class VisitasModule {}
