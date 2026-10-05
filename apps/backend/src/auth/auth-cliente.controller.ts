import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto';
import { RecuperarClienteDto } from './dto/recuperar-cliente.dto';
import { Public } from '../common/decorators/public.decorator';

/** Autenticacion del cliente (PWA Cliente). */
@Controller('auth/cliente')
export class AuthClienteController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('registrar')
  registrar(@Body() dto: RegistrarClienteDto) {
    return this.auth.registrarCliente(dto);
  }

  @Public()
  @Post('recuperar')
  recuperar(@Body() dto: RecuperarClienteDto) {
    return this.auth.recuperarCliente(dto);
  }
}
