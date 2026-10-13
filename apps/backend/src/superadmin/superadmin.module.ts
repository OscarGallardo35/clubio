import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SuperAdminService } from './superadmin.service';
import { SuperadminLocalesService } from './superadmin-locales.service';
import { SuperadminRecursosService } from './superadmin-recursos.service';
import { SuperAdminAuthController } from './superadmin-auth.controller';
import { SuperAdminLocalesController } from './superadmin-locales.controller';
import { SuperAdminLocalesAdminController } from './superadmin-locales-admin.controller';
import { JwtSuperAdminStrategy } from './strategies/jwt-superadmin.strategy';
import { ConfiguracionModule } from '../configuracion/configuracion.module';

/**
 * Panel del operador de la PLATAFORMA (PWA Superadmin).
 *
 * Modulo propio y aislado de `AuthModule`: el super-admin no es un Empleado, no
 * tiene negocio/sucursal y no comparte secreto JWT con ninguno de los tres contextos
 * existentes. PrismaService (global) y AuditoriaService (global) se inyectan solos;
 * RedisService lo expone RedisModule (global).
 *
 * `ConfiguracionModule` se importa para que el `PATCH .../configuracion` del panel
 * delegue en el MISMO servicio que usa el admin del dueno (no hay una segunda
 * implementacion de la config del club).
 */
@Module({
  imports: [PassportModule, JwtModule.register({}), ConfiguracionModule],
  controllers: [SuperAdminAuthController, SuperAdminLocalesController, SuperAdminLocalesAdminController],
  providers: [SuperAdminService, SuperadminLocalesService, SuperadminRecursosService, JwtSuperAdminStrategy],
  exports: [SuperAdminService],
})
export class SuperadminModule {}
