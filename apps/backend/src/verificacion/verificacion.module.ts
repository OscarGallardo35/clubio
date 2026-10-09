import { Module } from '@nestjs/common';
import { VerificacionService } from './verificacion.service';
import { VerificacionController } from './verificacion.controller';

/**
 * Verificacion publica de sellos/premio.
 *
 * No importa modulos: PrismaService es @Global y SucursalResolverService lo expone
 * SucursalesModule, tambien @Global.
 */
@Module({
  controllers: [VerificacionController],
  providers: [VerificacionService],
})
export class VerificacionModule {}
