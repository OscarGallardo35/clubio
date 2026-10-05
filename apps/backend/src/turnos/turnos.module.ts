import { Module } from '@nestjs/common';
import { TurnosService } from './turnos.service';
import { TurnosController } from './turnos.controller';
import { CheckinService } from './checkin.service';
import { CheckinController } from './checkin.controller';
import { AsignacionPedidosService } from './asignacion-pedidos.service';
import { TurnosScheduler } from './turnos.scheduler';
import { PushModule } from '../push/push.module';

/**
 * NO importa PedidosModule a proposito: AsignacionPedidosService solo CALCULA
 * destinatarios; el que emite WebSocket/push es pedidos.service. Asi se evita
 * la dependencia circular (no hace falta forwardRef).
 */
@Module({
  imports: [PushModule],
  controllers: [TurnosController, CheckinController],
  providers: [TurnosService, CheckinService, AsignacionPedidosService, TurnosScheduler],
  exports: [TurnosService, CheckinService, AsignacionPedidosService],
})
export class TurnosModule {}