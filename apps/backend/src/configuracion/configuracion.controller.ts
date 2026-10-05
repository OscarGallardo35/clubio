import { Body, Controller, Get, Headers, Ip, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ConfiguracionService } from './configuracion.service';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentDueno } from '../common/decorators/current-dueno.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { JwtDuenoGuard } from '../common/guards/jwt-dueno.guard';
import { JwtEmpleadoGuard } from '../common/guards/jwt-empleado.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';

@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly config: ConfiguracionService) {}

  /** Publico: config efectiva por slug (PWA Cliente), con override de sucursal opcional. */
  @Public()
  @Get('publica/:slug')
  publica(@Param('slug') slug: string, @Query('sucursalId') sucursalId?: string) {
    return this.config.publica(slug, sucursalId);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Get()
  obtener(@CurrentDueno() dueno: { negocioId: string }) {
    return this.config.obtener(dueno.negocioId);
  }

  /** Config efectiva: resuelve la sucursal por query/header/JWT/principal. */
  @UseGuards(JwtEmpleadoGuard, TenantGuard)
  @Get('efectiva')
  efectiva(
    @CurrentEmpleado() emp: { negocioId: string; id: string },
    @Query('sucursalId') sucursalId?: string,
    @Headers('x-sucursal-slug') sucursalSlug?: string,
  ) {
    return this.config.configEfectivaResolviendo(emp.negocioId, { sucursalId, sucursalSlug, empleadoId: emp.id });
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Patch()
  actualizar(
    @CurrentDueno() dueno: { id: string; negocioId: string },
    @Body() dto: ActualizarConfiguracionDto,
    @Ip() ip: string,
  ) {
    return this.config.actualizar(dueno.negocioId, dto, { empleadoId: dueno.id, ip });
  }
}
