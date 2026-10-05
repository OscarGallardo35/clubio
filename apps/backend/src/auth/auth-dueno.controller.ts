import { Body, Controller, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDuenoDto } from './dto/login-dueno.dto';
import { Verificar2FaDto } from './dto/verificar-2fa.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentDueno } from '../common/decorators/current-dueno.decorator';
import { JwtDuenoGuard } from '../common/guards/jwt-dueno.guard';
import { TenantGuard } from '../common/guards/tenant.guard';

/** Autenticacion del dueno (PWA Admin). */
@Controller('auth/dueno')
export class AuthDuenoController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDuenoDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.loginDueno(dto, ip, ua);
  }

  /** Segundo paso cuando el login devuelve requiere2FA: true. */
  @Public()
  @Post('verificar-2fa')
  verificar2FA(@Body() dto: Verificar2FaDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.verificar2FA(dto, ip, ua);
  }

  /** Rotacion de refresh token (invalida el anterior). */
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.refreshDueno(dto, ip, ua);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard)
  @Post('logout')
  logout(@CurrentDueno() dueno: { id: string }) {
    return this.auth.logoutDueno(dueno.id);
  }
}
