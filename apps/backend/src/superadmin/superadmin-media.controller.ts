import {
  Body, Controller, Headers, Ip, Post, UseGuards,
} from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { SuperadminLocalesService } from './superadmin-locales.service';
import { FirmarSubidaSuperAdminDto } from './dto/firmar-subida-superadmin.dto';
import { CurrentSuperAdmin } from '../common/decorators/current-superadmin.decorator';
import { SuperAdminGuard } from '../common/guards/superadmin.guard';
import { AuditoriaService } from '../common/auditoria/auditoria.service';

interface SuperAdminCtx {
  id: string;
}

/**
 * Firma de subidas DIRECTAS a Cloudinary desde el PANEL DE PLATAFORMA.
 *
 * Por que existe (el endpoint del dueno no sirve aca):
 *  - El panel administra VARIOS locales y el super-admin no tiene tenant, asi que el `negocioId`
 *    llega en el body (y no del token). El guard es `SuperAdminGuard` y NADA de `TenantGuard`.
 *  - La FIRMA es la MISMA que la del dueno: se delega en `MediaService.firmarSubida`, el servicio
 *    que ya usa `POST /media/firmar-subida`. No hay una segunda implementacion (misma carpeta
 *    `clubio/<negocioId>/carta`, misma transformacion, mismo `signature_version` del SDK).
 *
 * El binario NO pasa por el backend: aca solo se firma. El `negocioId` se valida contra la DB
 * (local existente y no eliminado) antes de firmar.
 */
@UseGuards(SuperAdminGuard)
@Controller('superadmin/media')
export class SuperAdminMediaController {
  constructor(
    private readonly media: MediaService,
    private readonly locales: SuperadminLocalesService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post('firmar-subida')
  async firmarSubida(
    @Body() dto: FirmarSubidaSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    // El negocioId viene del body: hay que validar que el local exista antes de firmar nada.
    await this.locales.exigirNegocio(dto.negocioId);

    const firma = this.media.firmarSubida(dto.negocioId, dto.tipo);
    await this.auditoria.registrarSuperAdmin({
      superAdminId: user.id,
      accion: 'superadmin.media.firmado',
      negocioId: dto.negocioId,
      detalle: { tipo: dto.tipo ?? 'carta', folder: firma.folder },
      ip: ip ?? null,
      userAgent: ua ?? null,
    });
    return firma;
  }
}
