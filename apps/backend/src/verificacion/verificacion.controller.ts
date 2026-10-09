import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { VerificacionService } from './verificacion.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Verificacion publica de la tarjeta de un cliente (link de WhatsApp del local).
 *
 * SIN auth y SIN cookie: el token de la URL es la unica llave. NO lleva TenantGuard
 * a proposito: el negocio sale del cliente dueño del token, no del header/subdominio
 * (asi un mismo link es valido aunque se abra desde el host equivocado).
 *
 * Controlador APARTE para no heredar ningun guard de nivel de clase: con un
 * controller sin guards, `@Public()` es explicito y no hay sorpresas.
 */
@Controller('verificacion')
export class VerificacionController {
  constructor(private readonly verificacion: VerificacionService) {}

  /** GET /api/verificacion/:token -> tarjeta solo-lectura. Token invalido: 404. */
  @Public()
  @Get(':token')
  verificar(@Param('token') token: string) {
    return this.verificacion.verificar(token);
  }

  /** GET /api/verificacion (sin token): 404 claro, NUNCA un listado. */
  @Public()
  @Get()
  sinToken(): never {
    throw new NotFoundException('Token de verificacion invalido');
  }
}
