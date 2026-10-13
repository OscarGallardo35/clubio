import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminAuthController } from './superadmin-auth.controller';
import { SuperAdminLocalesController } from './superadmin-locales.controller';
import { JwtSuperAdminStrategy } from './strategies/jwt-superadmin.strategy';

/**
 * Panel del operador de la PLATAFORMA (PWA Superadmin).
 *
 * Modulo propio y aislado de `AuthModule`: el super-admin no es un Empleado, no
 * tiene negocio/sucursal y no comparte secreto JWT con ninguno de los tres contextos
 * existentes. PrismaService (global) y AuditoriaService (global) se inyectan solos;
 * RedisService lo expone RedisModule (global).
 */
@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [SuperAdminAuthController, SuperAdminLocalesController],
  providers: [SuperAdminService, JwtSuperAdminStrategy],
  exports: [SuperAdminService],
})
export class SuperadminModule {}
