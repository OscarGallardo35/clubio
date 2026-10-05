import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { ConfiguracionService, CAMPOS_OVERRIDE } from '../configuracion/configuracion.service';
import type { ActualizarConfiguracionSucursalDto } from './dto/actualizar-configuracion-sucursal.dto';

export interface CtxConfigSucursal { empleadoId: string; ip?: string }

/**
 * CRUD del override de configuracion por sucursal.
 *
 * IMPORTANTE: el MERGE no se reimplementa aca. `ConfiguracionService.configEfectiva`
 * ya es la unica fuente de verdad (campo por campo, y un ARRAY VACIO hereda en vez
 * de overridear). Dos merges distintos se desincronizan tarde o temprano; este
 * servicio solo valida y escribe el override crudo.
 */
@Injectable()
export class ConfiguracionSucursalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  async exigirSucursal(negocioId: string, sucursalId: string) {
    const s = await this.prisma.sucursal.findFirst({
      where: { id: sucursalId, negocioId }, select: { id: true, nombre: true },
    });
    if (!s) throw new NotFoundException('Sucursal no encontrada');
    return s;
  }

  /** Override crudo (con nulls), para el panel de admin. */
  async obtenerOverride(negocioId: string, sucursalId: string) {
    await this.exigirSucursal(negocioId, sucursalId);
    return this.prisma.configuracionSucursal.findUnique({ where: { sucursalId } });
  }

  /** Config resuelta: delega en configEfectiva (fuente unica del merge). */
  async obtenerEfectiva(negocioId: string, sucursalId: string) {
    await this.exigirSucursal(negocioId, sucursalId);
    const efectiva = await this.configuracion.configEfectiva(negocioId, sucursalId) as unknown as Record<string, unknown>;
    return { sucursalId, configuracion: efectiva };
  }

  private async exigirOverridePermitido(negocioId: string) {
    const club = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { permitirOverrideSucursal: true },
    });
    if (!club) throw new NotFoundException('El negocio no tiene configuracion de club');
    if (club.permitirOverrideSucursal === false) {
      throw new ForbiddenException('El negocio no permite overrides por sucursal');
    }
    return club;
  }

  async crearOActualizar(
    negocioId: string, sucursalId: string,
    dto: ActualizarConfiguracionSucursalDto, ctx: CtxConfigSucursal,
  ) {
    await this.exigirSucursal(negocioId, sucursalId);
    await this.exigirOverridePermitido(negocioId);

    // Validacion: si se define costoEnvio, DELIVERY tiene que estar habilitado
    // (en el override o en el global).
    if (dto.costoEnvio !== undefined && dto.costoEnvio !== null) {
      const efectiva = await this.configuracion.configEfectiva(negocioId, sucursalId) as unknown as {
        tiposPedidoHabilitados: string[];
      };
      const tipos = dto.tiposPedidoHabilitados?.length
        ? dto.tiposPedidoHabilitados
        : (efectiva.tiposPedidoHabilitados ?? []);
      if (!tipos.includes('DELIVERY')) {
        throw new BadRequestException(
          'No se puede definir costoEnvio si DELIVERY no esta habilitado en los tipos de pedido',
        );
      }
    }

    const data: Prisma.ConfiguracionSucursalUncheckedCreateInput = {
      sucursalId,
      ...(dto.premioTexto !== undefined ? { premioTexto: dto.premioTexto } : {}),
      ...(dto.sellosParaPremio !== undefined ? { sellosParaPremio: dto.sellosParaPremio } : {}),
      ...(dto.sellosBienvenida !== undefined ? { sellosBienvenida: dto.sellosBienvenida } : {}),
      ...(dto.limiteVisitasPorDia !== undefined ? { limiteVisitasPorDia: dto.limiteVisitasPorDia } : {}),
      ...(dto.horasMinimasEntreVisitas !== undefined ? { horasMinimasEntreVisitas: dto.horasMinimasEntreVisitas } : {}),
      ...(dto.tiposPedidoHabilitados !== undefined ? { tiposPedidoHabilitados: dto.tiposPedidoHabilitados } : {}),
      ...(dto.modosPagoHabilitados !== undefined ? { modosPagoHabilitados: dto.modosPagoHabilitados } : {}),
      ...(dto.costoEnvio !== undefined ? { costoEnvio: dto.costoEnvio === null ? null : new Prisma.Decimal(dto.costoEnvio) } : {}),
      ...(dto.pedidoMinimoDelivery !== undefined ? { pedidoMinimoDelivery: dto.pedidoMinimoDelivery === null ? null : new Prisma.Decimal(dto.pedidoMinimoDelivery) } : {}),
      ...(dto.zonaEntrega !== undefined ? { zonaEntrega: dto.zonaEntrega } : {}),
      ...(dto.transferenciaAlias !== undefined ? { transferenciaAlias: dto.transferenciaAlias } : {}),
      ...(dto.transferenciaCbu !== undefined ? { transferenciaCbu: dto.transferenciaCbu } : {}),
      ...(dto.transferenciaTitular !== undefined ? { transferenciaTitular: dto.transferenciaTitular } : {}),
      ...(dto.transferenciaBanco !== undefined ? { transferenciaBanco: dto.transferenciaBanco } : {}),
    };
    const { sucursalId: _s, ...update } = data;

    const override = await this.prisma.configuracionSucursal.upsert({
      where: { sucursalId },
      update,
      create: data,
    });

    // La config efectiva cacheada de esa sucursal quedo vieja.
    await this.configuracion.invalidarConfigEfectiva(negocioId, sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.override_actualizado', empleadoId: ctx.empleadoId,
      detalle: { sucursalId, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return override;
  }

  async eliminarOverride(negocioId: string, sucursalId: string, ctx: CtxConfigSucursal) {
    await this.exigirSucursal(negocioId, sucursalId);
    const r = await this.prisma.configuracionSucursal.deleteMany({ where: { sucursalId } });
    await this.configuracion.invalidarConfigEfectiva(negocioId, sucursalId);
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.override_eliminado', empleadoId: ctx.empleadoId,
      detalle: { sucursalId, existia: r.count > 0 }, ip: ctx.ip,
    });
    return { ok: true, eliminado: r.count > 0, sucursalId };
  }

  /** Campos que se pueden overridear (expuesto para el panel). */
  camposOverrideables() {
    return CAMPOS_OVERRIDE;
  }
}