import { Body, Controller, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginEmpleadoDto } from './dto/login-empleado.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { JwtEmpleadoGuard } from '../common/guards/jwt-empleado.guard';

/** Autenticacion de staff (PWA Staff). */
@Controller('auth/empleado')
export class AuthEmpleadoController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginEmpleadoDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.loginEmpleado(dto, ip, ua);
  }

  @UseGuards(JwtEmpleadoGuard)
  @Post('logout')
  logout(@CurrentEmpleado() empleado: { id: string }) {
    return this.auth.logoutEmpleado(empleado.id);
  }
}
