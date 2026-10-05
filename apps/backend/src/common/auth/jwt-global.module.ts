import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * Expone JwtService de forma GLOBAL.
 *
 * Necesario para guards que inyectan JwtService (ej. StaffGuard, que valida
 * tokens de dueno Y de empleado probando ambos secretos). Los guards basados
 * en Passport (JwtEmpleadoGuard, etc.) no lo necesitaban porque resolvian la
 * estrategia, no el servicio.
 *
 * No define secreto por defecto a proposito: cada verify() pasa el suyo.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  exports: [JwtModule],
})
export class JwtGlobalModule {}
