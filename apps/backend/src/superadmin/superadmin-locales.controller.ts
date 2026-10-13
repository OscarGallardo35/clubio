import { Controller, Get, Headers, Ip, Query, UseGuards } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { ListarLocalesSuperAdminDto } from './dto/listar-locales.dto';
import { CurrentSuperAdmin } from '../common/decorators/current-superadmin.decorator';
import { SuperAdminGuard } from '../common/guards/superadmin.guard';
import { AuditoriaService } from '../common/auditoria/auditoria.service';

/**
 * Endpoints de PLATAFORMA.
 *
 * Rieles de arquitectura (importante):
 *  - NO pasan por `TenantGuard`: el super-admin no tiene `negocioId` ni tenant. Estos
 *    endpoints ven TODOS los locales a proposito (es el panel del operador).
 *  - El guard es `SuperAdminGuard` (claim `tipo === 'superadmin'` + secreto propio).
 *  - Auditados con `registrarSuperAdmin` (EventoAuditoriaSuperAdmin). Las LECTURAS tambien
 *    se auditan: es un panel de plataforma y de trafico bajo, y saber quien miro la lista
 *    de locales es parte de la trazabilidad que pidio el panel.
 */
@UseGuards(SuperAdminGuard)
@Controller('superadmin')
export class SuperAdminLocalesController {
  constructor(
    private readonly superadmin: SuperAdminService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Lista TODOS los locales (sin filtro de tenant) + buscador por nombre/slug. */
  @Get('locales')
  async locales(
    @Query() filtros: ListarLocalesSuperAdminDto,
    @CurrentSuperAdmin() user: { id: string },
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const resultado = await this.superadmin.listarLocales(filtros);
    await this.auditoria.registrarSuperAdmin({
      superAdminId: user.id,
      accion: 'superadmin.locales.listado',
      detalle: { search: filtros.search ?? null, plan: filtros.plan ?? null, total: resultado.total },
      ip: ip ?? null,
      userAgent: ua ?? null,
    });
    return resultado;
  }

  /** Metricas basicas para el dashboard del shell. */
  @Get('resumen')
  async resumen(
    @CurrentSuperAdmin() user: { id: string },
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const resultado = await this.superadmin.resumen();
    await this.auditoria.registrarSuperAdmin({
      superAdminId: user.id,
      accion: 'superadmin.resumen.leido',
      detalle: { locales: resultado.locales.total },
      ip: ip ?? null,
      userAgent: ua ?? null,
    });
    return resultado;
  }
}
