import { Global, Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanGuard } from './plan.guard';
import { LimitesService } from './limites.service';
import { UsoMensualService } from './uso-mensual.service';
import { UsoMensualScheduler } from './uso-mensual.scheduler';
import { PlanesController } from './planes.controller';
import { PushModule } from '../push/push.module';

/**
 * @Global() a proposito: PlanGuard se registra global (APP_GUARD) y es inyectado
 * por el framework, y LimitesService/UsoMensualService los usan clientes,
 * empleados, sucursales, carta, pedidos y push sin repetir el import.
 */
@Global()
@Module({
  imports: [PushModule],
  controllers: [PlanesController],
  providers: [PlanService, PlanGuard, LimitesService, UsoMensualService, UsoMensualScheduler],
  exports: [PlanService, PlanGuard, LimitesService, UsoMensualService],
})
export class PlanesModule {}