import { Body, Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { NegociosService } from '../negocios/negocios.service';
import { LoginEmpleadoDto } from './dto/login-empleado.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';

/** Autenticacion de staff (PWA Staff). */
@Controller('auth/empleado')
export class AuthEmpleadoController {
  constructor(
    private readonly auth: AuthService,
    private readonly negocios: NegociosService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginEmpleadoDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.loginEmpleado(dto, ip, ua);
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
  logout(@CurrentEmpleado() empleado: { id: string }) {
    return this.auth.logoutEmpleado(empleado.id);
  }
}
