import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SuperAdminService } from './superadmin.service';
import { LoginSuperAdminDto } from './dto/login-superadmin.dto';
import { Verificar2FaSuperAdminDto } from './dto/verificar-2fa-superadmin.dto';
import { RefreshSuperAdminDto } from './dto/refresh-superadmin.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentSuperAdmin } from '../common/decorators/current-superadmin.decorator';
import { SuperAdminGuard } from '../common/guards/superadmin.guard';
import {
  COOKIE_SUPERADMIN,
  opcionesBorrarCookieSuperAdmin,
  opcionesCookieSuperAdmin,
} from '../common/utils/cookie.util';

/**
 * Autenticacion del SUPER-ADMIN (panel de plataforma).
 *
 * Mismo patron que `/auth/dueno`:
 *  - paso 1 (email + password): si hay 2FA, devuelve `{ requiere2FA, challengeToken }`
 *    y NO emite sesion; si no, emite la cookie.
 *  - paso 2 (codigo TOTP): ahi SI se emite la cookie.
 * El token tambien sale en el body (compatibilidad y harness de integracion); la via
 * principal es la cookie HttpOnly `superadmin_token`, que es HOST-ONLY (ver cookie.util).
 */
@Controller('superadmin/auth')
export class SuperAdminAuthController {
  constructor(private readonly superadmin: SuperAdminService) {}

  /** Anti fuerza bruta: 5 intentos por minuto y por IP (el ThrottlerGuard es global). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginSuperAdminDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.superadmin.login(dto, ip, ua);
    if ('accessToken' in resultado) {
      res.cookie(COOKIE_SUPERADMIN, resultado.accessToken, opcionesCookieSuperAdmin(resultado.expiresIn));
    }
    return resultado;
  }

  /** Segundo paso cuando el login devuelve `requiere2FA: true`. Aca SI se emite la cookie. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa')
  async verificar2FA(
    @Body() dto: Verificar2FaSuperAdminDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.superadmin.verificar2FA(dto, ip, ua);
    res.cookie(COOKIE_SUPERADMIN, resultado.accessToken, opcionesCookieSuperAdmin(resultado.expiresIn));
    return resultado;
  }

  /** Rotacion del refresh token (invalida el anterior). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshSuperAdminDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.superadmin.refresh(dto, ip, ua);
  }

  /** Quien es el operador que esta pidiendo: la PWA lo llama al montar. */
  @UseGuards(SuperAdminGuard)
  @Get('me')
  me(
    @CurrentSuperAdmin()
    user: { id: string; email: string; nombre: string; twoFactorEnabled: boolean },
  ) {
    return this.superadmin.me(user);
  }

  /** Cierra la sesion: borra las sesiones del operador y limpia la cookie. */
  @UseGuards(SuperAdminGuard)
  @Post('logout')
  logout(
    @CurrentSuperAdmin() user: { id: string },
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie(COOKIE_SUPERADMIN, opcionesBorrarCookieSuperAdmin());
    return this.superadmin.logout(user.id, ip, ua);
  }
}
