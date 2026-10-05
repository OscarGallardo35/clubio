
import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { PedidosGateway } from './pedidos.gateway';
import { PedidosScheduler } from './pedidos.scheduler';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PushModule } from '../push/push.module';
import { TurnosModule } from '../turnos/turnos.module';

@Module({
  // TurnosModule aporta AsignacionPedidosService (una sola direccion: sin ciclo)
  imports: [ConfiguracionModule, PushModule, TurnosModule],
  controllers: [PedidosController],
  providers: [PedidosService, PedidosGateway, PedidosScheduler, WsJwtGuard],
  exports: [PedidosService, PedidosGateway],
})
export class PedidosModule {}
