import { Body, Controller, Get, Headers, Ip, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { NegociosService } from '../negocios/negocios.service';
import { LoginDuenoDto } from './dto/login-dueno.dto';
import { Verificar2FaDto } from './dto/verificar-2fa.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentDueno } from '../common/decorators/current-dueno.decorator';
import { JwtDuenoGuard } from '../common/guards/jwt-dueno.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { COOKIE_DUENO, opcionesBorrarCookieDueno, opcionesCookieDueno } from '../common/utils/cookie.util';

/** Autenticacion del dueno (PWA Admin). */
@Controller('auth/dueno')
export class AuthDuenoController {
  constructor(
    private readonly auth: AuthService,
    private readonly negocios: NegociosService,
  ) {}

  /**
   * Login (email + password). El token sale SIEMPRE en el body (compatibilidad y harness) y
   * ademas se setea la cookie HttpOnly con las MISMAS banderas que cliente y staff: la PWA Admin
   * no tiene por que guardar el token en un lugar que JS pueda leer.
   */
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDuenoDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.auth.loginDueno(dto, ip, ua);
    // Con 2FA prendido el primer paso NO emite sesion (devuelve `requiere2FA` + el challenge):
    // sin accessToken no hay cookie todavia. El `in` va sobre `resultado` (no sobre una copia)
    // para que TS estreche la union y `expiresIn` exista.
    if ('accessToken' in resultado) {
      res.cookie(COOKIE_DUENO, resultado.accessToken, opcionesCookieDueno(resultado.expiresIn));
    }
    return resultado;
  }

  /** Segundo paso cuando el login devuelve requiere2FA: true. Aca SI se emite la cookie. */
  @Public()
  @Post('verificar-2fa')
  async verificar2FA(
    @Body() dto: Verificar2FaDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.auth.verificar2FA(dto, ip, ua);
    res.cookie(COOKIE_DUENO, resultado.accessToken, opcionesCookieDueno(resultado.expiresIn));
    return resultado;
  }

  /** Rotacion de refresh token (invalida el anterior). */
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.refreshDueno(dto, ip, ua);
  }

  /**
   * Quien es el que esta pidiendo: la PWA Admin lo llama al montar.
   *
   * Simetrico a `/auth/empleado/me`: el negocio se arma con `publicoPorSlug` (el mismo shape
   * publico que ve la PWA Cliente) MAS las features del plan, que es lo que el panel necesita
   * para esconder lo que el plan no incluye.
   */
  @UseGuards(JwtDuenoGuard, TenantGuard)
  @Get('me')
  async me(@CurrentDueno() dueno: { id: string; nombre: string; negocioId: string; negocioSlug: string }) {
    const sesion = await this.auth.meDueno(dueno);
    const [publico, plan] = await Promise.all([
      this.negocios.publicoPorSlug(dueno.negocioSlug),
      this.negocios.features(dueno.negocioId),
    ]);
    return { ...sesion, negocio: { ...publico, plan: plan.plan, features: plan.features } };
  }

  @UseGuards(JwtDuenoGuard, TenantGuard)
  @Post('logout')
  logout(@CurrentDueno() dueno: { id: string }, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_DUENO, opcionesBorrarCookieDueno());
    return this.auth.logoutDueno(dueno.id);
  }
}
