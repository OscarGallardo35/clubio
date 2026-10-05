
import { Module } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';
import { PedidosGateway } from './pedidos.gateway';
import { PedidosScheduler } from './pedidos.scheduler';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [ConfiguracionModule, PushModule], // config efectiva + push
  controllers: [PedidosController],
  providers: [PedidosService, PedidosGateway, PedidosScheduler, WsJwtGuard],
  exports: [PedidosService, PedidosGateway],
})
export class PedidosModule {}
