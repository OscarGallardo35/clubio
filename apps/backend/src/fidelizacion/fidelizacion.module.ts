import { Module } from '@nestjs/common';
import { FidelizacionService } from './fidelizacion.service';
import { ClientesModule } from '../clientes/clientes.module';

/**
 * @Global por el mismo motivo que SucursalesModule: la acreditacion la usan Visitas (visita
 * aprobada) y Pedidos (pedido entregado), y ninguna de las dos deberia tener que importar a la
 * otra. Se registra una vez en AppModule y listo.
 */
@Module({
  imports: [ClientesModule], // aporta SegmentosService
  providers: [FidelizacionService],
  exports: [FidelizacionService],
})
export class FidelizacionModule {}
