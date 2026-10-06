import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthEmpleadoController } from './auth-empleado.controller';
import { AuthDuenoController } from './auth-dueno.controller';
import { AuthClienteController } from './auth-cliente.controller';
import { NegociosModule } from '../negocios/negocios.module';
import { JwtEmpleadoStrategy } from './strategies/jwt-empleado.strategy';
import { JwtDuenoStrategy } from './strategies/jwt-dueno.strategy';
import { JwtClienteStrategy } from './strategies/jwt-cliente.strategy';

/**
 * Auth dual (staff / dueno / cliente).
 * Los secretos se pasan por firma individual (uno por tipo de token),
 * por eso JwtModule se registra vacio.
 */
@Module({
  imports: [PassportModule, JwtModule.register({}), NegociosModule],
  controllers: [AuthEmpleadoController, AuthDuenoController, AuthClienteController],
  providers: [AuthService, JwtEmpleadoStrategy, JwtDuenoStrategy, JwtClienteStrategy],
  exports: [AuthService],
})
export class AuthModule {}
