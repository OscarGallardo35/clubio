import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto';
import { RecuperarClienteDto } from './dto/recuperar-cliente.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentCliente } from '../common/decorators/current-cliente.decorator';
import { JwtClienteGuard } from '../common/guards/jwt-cliente.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import {
  COOKIE_CLIENTE,
  opcionesBorrarCookieCliente,
  opcionesCookieCliente,
} from '../common/utils/cookie.util';

interface ClienteAuth { id: string; negocioId: string; nombre: string; telefono: string }

/**
 * Autenticacion del cliente (PWA Cliente).
 *
 * A1 (#3.0): registrar/recuperar setean ademas una cookie HttpOnly con el token.
 * Se sigue devolviendo `accessToken` en el body para pruebas y para el handshake
 * del WebSocket (que no puede leer cookies HttpOnly desde JS).
 */
@Controller('auth/cliente')
export class AuthClienteController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('registrar')
  async registrar(@Body() dto: RegistrarClienteDto, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.auth.registrarCliente(dto);
    res.cookie(COOKIE_CLIENTE, resultado.accessToken, opcionesCookieCliente(resultado.expiresIn));
    return resultado;
  }

  @Public()
  @Post('recuperar')
  async recuperar(@Body() dto: RecuperarClienteDto, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.auth.recuperarCliente(dto);
    res.cookie(COOKIE_CLIENTE, resultado.accessToken, opcionesCookieCliente(resultado.expiresIn));
    return resultado;
  }

  /**
   * Estado inicial del QR #2: la PWA lo llama al montar. 401 => mostrar registro;
   * 200 => el cliente ya esta identificado (y sabe si ya sumo hoy).
   */
  @UseGuards(JwtClienteGuard, TenantGuard)
  @Get('me')
  me(@CurrentCliente() cli: ClienteAuth) {
    return this.auth.meCliente(cli.id);
  }

  /** Limpia la cookie. El token de cliente no tiene estado en el servidor. */
  @UseGuards(JwtClienteGuard)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_CLIENTE, opcionesBorrarCookieCliente());
    return this.auth.logoutCliente();
  }
}
