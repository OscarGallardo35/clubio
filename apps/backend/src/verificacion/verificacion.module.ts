import { Module } from '@nestjs/common';
import { VerificacionService } from './verificacion.service';
import { VerificacionController } from './verificacion.controller';
import { VisitasModule } from '../visitas/visitas.module';

/**
 * Verificacion publica de sellos/premio.
 *
 * PrismaService es @Global y SucursalResolverService lo expone SucursalesModule (tambien
 * @Global). VisitasModule aporta el helper COMPARTIDO `saldosEfectivos`, para que la pagina
 * publica resuelva los saldos (sellos Y puntos, GLOBAL vs POR_SUCURSAL) con la MISMA regla
 * que GET /visitas/mi-tarjeta en vez de reimplementarla.
 */
@Module({
  imports: [VisitasModule],
  controllers: [VerificacionController],
  providers: [VerificacionService],
})
export class VerificacionModule {}
