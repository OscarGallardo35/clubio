import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AsignacionService } from './asignacion.service';
import { Public } from '../common/decorators/public.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { TenantGuard } from '../common/guards/tenant.guard';

/**
 * Modificadores de cara a la PWA Cliente (QR #1: el modal de un item).
 *
 * Va en un controller APARTE a proposito: el ModificadoresController de staff
 * tiene StaffGuard + RolesGuard + PlanGuard a NIVEL DE CLASE, asi que un
 * `@Public()` en un metodo suyo no lo salvaria de esos guards (se evaluan
 * igual). Aca solo corre TenantGuard.
 *
 * Ruta distinta a la de staff (`GET /modificadores/items`), sin colision.
 */
@Controller('modificadores')
export class ModificadoresPublicoController {
  constructor(private readonly asignacion: AsignacionService) {}

  @Public()
  @UseGuards(TenantGuard)
  @Get('items/:itemId/grupos')
  gruposDeItem(@Tenant() tenant: string | null, @Param('itemId') itemId: string) {
    // Sin tenant no hay negocio que resolver. TenantGuard deja pasar un tenant
    // nulo (por ejemplo con hostname `localhost`), asi que se corta aca: si no,
    // se buscaria el slug literal "null".
    if (!tenant) throw new BadRequestException('Falta el tenant (X-Tenant-Slug o subdominio)');
    return this.asignacion.gruposDeItemPublico(tenant, itemId);
  }
}
