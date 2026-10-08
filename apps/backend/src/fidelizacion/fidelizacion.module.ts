import { Global, Module } from '@nestjs/common';
import { FidelizacionService } from './fidelizacion.service';
import { ClientesModule } from '../clientes/clientes.module';

/**
 * @Global por el mismo motivo que SucursalesModule: la acreditacion la usan Visitas (visita
 * aprobada) y Pedidos (pedido entregado), y ninguna de las dos deberia tener que importar a la
 * otra. Se registra una vez en AppModule y listo.
 *
 * El `@Global()` NO es decorativo: sin el, Nest no resuelve el provider en VisitasService ni en
 * PedidosService y el backend no arranca (el deploy falla con "Nest can't resolve dependencies of
 * the VisitasService (..., FidelizacionService)"). Ya paso una vez.
 */
@Global()
@Module({
  imports: [ClientesModule], // aporta SegmentosService
  providers: [FidelizacionService],
  exports: [FidelizacionService],
})
export class FidelizacionModule {}
