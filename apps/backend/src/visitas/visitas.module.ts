import { Module } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { VisitasController } from './visitas.controller';
import { VisitasGateway } from './visitas.gateway';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { ClientesModule } from '../clientes/clientes.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PushModule } from '../push/push.module';
import { HorariosModule } from '../horarios/horarios.module';

@Module({
  imports: [ClientesModule, ConfiguracionModule, PushModule, HorariosModule], // Clientes aporta SegmentosService; Push aporta DisparosService; Configuracion, la config cacheada (configEfectivaCacheada)
  controllers: [VisitasController],
  providers: [VisitasService, VisitasGateway, WsJwtGuard],
  exports: [VisitasService, VisitasGateway],
})
export class VisitasModule {}
