import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import type { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto';

/** Campos que una sucursal puede sobreescribir (null = hereda del global). */
const CAMPOS_OVERRIDE = [
  'premioTexto', 'sellosParaPremio', 'sellosBienvenida',
  'limiteVisitasPorDia', 'horasMinimasEntreVisitas',
  'tiposPedidoHabilitados', 'modosPagoHabilitados', 'costoEnvio',
  'pedidoMinimoDelivery', 'zonaEntrega',
  'transferenciaAlias', 'transferenciaCbu', 'transferenciaTitular', 'transferenciaBanco',
] as const;

@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
  ) {}

  async obtener(negocioId: string) {
    const config = await this.prisma.configuracionClub.findUnique({ where: { negocioId } });
    if (!config) throw new NotFoundException('El negocio no tiene configuracion de club');
    return config;
  }

  /** Config publica (sin auth) resuelta por slug + sucursal opcional. */
  async publica(slug: string, sucursalId?: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { slug, activo: true },
      select: { id: true, nombre: true, slug: true, plan: true, modoClientes: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    return { negocio, configuracion: await this.configEfectiva(negocio.id, sucursalId) };
  }

  /**
   * Config EFECTIVA: global + override de sucursal campo por campo.
   * Un campo null en la sucursal hereda el valor global.
   */
  async configEfectiva(negocioId: string, sucursalId?: string) {
    const club = await this.prisma.configuracionClub.findUnique({ where: { negocioId } });
    if (!club) throw new NotFoundException('El negocio no tiene configuracion de club');
    if (!sucursalId) return { ...club, overrideAplicado: false };

    const ov = await this.prisma.configuracionSucursal.findUnique({ where: { sucursalId } });
    if (!ov) return { ...club, overrideAplicado: false, sucursalId };

    const merged: Record<string, unknown> = { ...club };
    for (const campo of CAMPOS_OVERRIDE) {
      const valor = (ov as Record<string, unknown>)[campo];
      const esVacio = valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0);
      if (!esVacio) merged[campo] = valor;
    }
    return { ...merged, overrideAplicado: true, sucursalId };
  }

  /** Config efectiva resolviendo la sucursal por las 4 fuentes (refinamiento 1). */
  async configEfectivaResolviendo(
    negocioId: string,
    opts: { sucursalId?: string | null; sucursalSlug?: string | null; empleadoId?: string | null },
  ) {
    const sucursal = await this.resolver.resolverSucursal(negocioId, opts);
    return this.configEfectiva(negocioId, sucursal.id as string);
  }

  async actualizar(
    negocioId: string,
    dto: ActualizarConfiguracionDto,
    ctx: { empleadoId?: string; ip?: string },
  ) {
    const config = await this.prisma.configuracionClub.update({
      where: { negocioId },
      data: { ...dto },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'configuracion.actualizada', empleadoId: ctx.empleadoId,
      detalle: { campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return config;
  }
}
