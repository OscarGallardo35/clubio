import { Body, Controller, Get, Ip, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { NegociosService } from './negocios.service';
import { ActualizarNegocioDto } from './dto/actualizar-negocio.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentDueno } from '../common/decorators/current-dueno.decorator';
import { JwtDuenoGuard } from '../common/guards/jwt-dueno.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';

@Controller('negocios')
export class NegociosController {
  constructor(private readonly negocios: NegociosService) {}

  /** Publico: la PWA Cliente resuelve el negocio por slug. */
  @Public()
  @Get('publico/:slug')
  publico(@Param('slug') slug: string, @Query('sucursalSlug') sucursalSlug?: string) {
    return this.negocios.publicoPorSlug(slug, sucursalSlug);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Get('mi-negocio')
  miNegocio(@CurrentDueno() dueno: { negocioId: string }) {
    return this.negocios.miNegocio(dueno.negocioId);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Get('features')
  features(@CurrentDueno() dueno: { negocioId: string }) {
    return this.negocios.features(dueno.negocioId);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Get('qr-info')
  qrInfo(@CurrentDueno() dueno: { negocioId: string }) {
    return this.negocios.qrInfo(dueno.negocioId);
  }

  @UseGuards(JwtDuenoGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Patch()
  actualizar(
    @CurrentDueno() dueno: { id: string; negocioId: string },
    @Body() dto: ActualizarNegocioDto,
    @Ip() ip: string,
  ) {
    return this.negocios.actualizar(dueno.negocioId, dto, { empleadoId: dueno.id, ip });
  }
}
