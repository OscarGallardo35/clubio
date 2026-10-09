import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { StaffGuard } from '../common/guards/staff.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
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
 * El guard es el de dueno: `StaffGuard` valida la cookie `dueno_token` (o el Bearer) y `RolesGuard`
 * limita a `DUENO`. El `negocioId` sale del token del empleado, nunca del body.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @UseGuards(StaffGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Post('firmar-subida')
  firmarSubida(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: FirmarSubidaDto) {
    return this.media.firmarSubida(emp.negocioId, dto.tipo);
  }
}
