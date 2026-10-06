import { Body, Controller, Get, Headers, Ip, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { NegociosService } from '../negocios/negocios.service';
import { LoginEmpleadoDto } from './dto/login-empleado.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import {
  COOKIE_EMPLEADO,
  opcionesBorrarCookieEmpleado,
  opcionesCookieEmpleado,
} from '../common/utils/cookie.util';

/** Autenticacion de staff (PWA Staff). */
@Controller('auth/empleado')
export class AuthEmpleadoController {
  constructor(
    private readonly auth: AuthService,
    private readonly negocios: NegociosService,
  ) {}

  /**
   * Login por PIN. Ademas del token en el body, setea la cookie HttpOnly con las
   * MISMAS banderas que la del cliente (simetria deliberada: un solo patron de
   * auth en el repo). El token del body se sigue devolviendo para el harness de
   * integracion y para clientes no-navegador.
   */
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginEmpleadoDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.auth.loginEmpleado(dto, ip, ua);
    res.cookie(COOKIE_EMPLEADO, resultado.accessToken, opcionesCookieEmpleado(resultado.expiresIn));
    return resultado;
  }

  /**
   * Quien es el que esta pidiendo: la PWA Staff lo llama al montar.
   *
   * Va con `StaffGuard` (y no con `JwtEmpleadoGuard`) porque el dueno tambien
   * entra a la PWA Staff: el guard acepta los dos tipos de token y devuelve
   * `tipo` para que la app sepa con cual esta hablando.
   *
   * El negocio se arma con `publicoPorSlug` (el mismo shape publico que usa la
   * PWA Cliente: nombre, logo, colores, configuracion, sucursales) MAS las
   * features del plan, que es lo que la Staff necesita para esconder lo que el
   * plan no incluye. No se reusa `miNegocio`, que trae campos de administracion.
   */
  @UseGuards(StaffGuard)
  @Get('me')
  async me(@CurrentEmpleado() user: Parameters<AuthService['meEmpleado']>[0]) {
    const sesion = await this.auth.meEmpleado(user);
    const [publico, plan] = await Promise.all([
      this.negocios.publicoPorSlug(user.negocioSlug),
      this.negocios.features(user.negocioId),
    ]);
    return { ...sesion, negocio: { ...publico, plan: plan.plan, features: plan.features } };
  }

  @UseGuards(StaffGuard)
  @Post('logout')
  logout(@CurrentEmpleado() empleado: { id: string }, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_EMPLEADO, opcionesBorrarCookieEmpleado());
    return this.auth.logoutEmpleado(empleado.id);
  }
}
