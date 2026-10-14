import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { StaffGuard } from '../common/guards/staff.guard';
import { PermisoGuard } from '../common/guards/permiso.guard';
import { PermiteSi } from '../common/decorators/permiso.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { MediaService } from './media.service';
import { FirmarSubidaDto } from './dto/firmar-subida.dto';

interface EmpleadoAuth {
  id: string;
  negocioId: string;
  rol: RolEmpleado;
  sucursalId: string;
}

/**
 * Firma de subidas directas (el binario NO pasa por el backend).
 *
 * El guard es el de staff: `StaffGuard` valida la cookie `empleado_token` (o `dueno_token` / el
 * Bearer) y `PermisoGuard` autoriza por permiso. El baseline es DUENO (es como estaba este
 * endpoint); un ENCARGADO sin el permiso sigue recibiendo 403, y un empleado al que el dueno le
 * prendio `puedeEditarCarta` (el paquete completo de la carta, que incluye la foto) tambien firma.
 * El `negocioId` sale del token del empleado, nunca del body: la carpeta siempre cuelga de SU negocio.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @UseGuards(StaffGuard, PermisoGuard)
  @PermiteSi('subir_carta')
  @Post('firmar-subida')
  firmarSubida(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: FirmarSubidaDto) {
    return this.media.firmarSubida(emp.negocioId, dto.tipo);
  }
}
