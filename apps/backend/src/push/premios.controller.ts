import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { PremiosService } from './premios.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Throttle } from '@nestjs/throttler';

interface EmpleadoAuth {
  id: string;
  negocioId: string;
  rol: RolEmpleado;
}

/**
 * PREMIOS que el cliente ACEPTA desde la notificacion.
 *
 *  - GET  /premios/:token            -> datos de la modal de aceptar (PUBLICO).
 *  - POST /premios/:token/aceptar    -> el cliente ACEPTA (PUBLICO + throttled + claim atomico).
 *  - GET  /premios/:token/verificacion -> lo que ve el STAFF en el link de verificacion (PUBLICO).
 *  - POST /premios/:token/canjear    -> el STAFF marca CANJEADO (requiere login de staff).
 *
 * El TOKEN de la URL es la unica llave de las rutas publicas (mismo criterio que
 * VerificacionController): no llevan TenantGuard a proposito, el negocio sale del premio
 * dueño del token. El canje SI exige staff autenticado y valida que el negocio coincida.
 */
@Controller('premios')
export class PremiosController {
  constructor(private readonly premios: PremiosService) {}

  @Public()
  @Get(':token')
  publico(@Param('token') token: string) {
    return this.premios.publico(token);
  }

  /** Anti abuso: 20 intentos por minuto y por IP (el claim atomico ya evita el doble credito). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':token/aceptar')
  aceptar(@Param('token') token: string) {
    return this.premios.aceptar(token);
  }

  @Public()
  @Get(':token/verificacion')
  verificacion(@Param('token') token: string) {
    return this.premios.verificacion(token);
  }

  @UseGuards(StaffGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post(':token/canjear')
  canjear(@Param('token') token: string, @CurrentEmpleado() emp: EmpleadoAuth) {
    return this.premios.canjear(token, { id: emp.id, negocioId: emp.negocioId });
  }
}
