import { BadRequestException, Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SucursalesService } from './sucursales.service';
import { Public } from '../common/decorators/public.decorator';
import { TenantGuard } from '../common/guards/tenant.guard';

/**
 * Sucursales de cara a la PWA Cliente (selector de sucursal del QR).
 *
 * Va en un controller APARTE porque SucursalesController declara
 * `@UseGuards(StaffGuard, TenantGuard, RolesGuard)` a NIVEL DE CLASE: un metodo
 * `@Public()` adentro suyo igual pasaria por StaffGuard y responderia 401.
 * (Ese era el bug real: el endpoint se documentaba como publico y devolvia 401.)
 *
 * Solo lectura y solo activas: sin metricas ni datos internos.
 */
@Controller('sucursales')
export class SucursalesPublicoController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Public()
  @UseGuards(TenantGuard)
  @Get('publico')
  publico(@Req() req: { tenant?: string }) {
    if (!req.tenant) throw new BadRequestException('Falta el tenant (X-Tenant-Slug o subdominio)');
    return this.sucursales.listarPublicoPorSlug(req.tenant);
  }
}
