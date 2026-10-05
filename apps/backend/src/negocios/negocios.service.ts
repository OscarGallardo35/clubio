import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { ActualizarNegocioDto } from './dto/actualizar-negocio.dto';

/** Campos seguros para exponer publicamente (PWA Cliente). */
const PUBLICO = {
  id: true, nombre: true, slug: true, direccion: true, telefono: true, email: true,
  logoUrl: true, colorPrimario: true, colorSecundario: true, placeId: true,
  urlMenu: true, urlClub: true, plan: true, modoClientes: true, activo: true,
} as const;

@Injectable()
export class NegociosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Refinamiento 6: incluye plan, modoClientes, features y sucursales activas. */
  async miNegocio(negocioId: string) {
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { ...PUBLICO },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const [features, sucursalesActivas] = await Promise.all([
      this.prisma.planFeature.findMany({ where: { plan: negocio.plan } }),
      this.prisma.sucursal.count({ where: { negocioId, activa: true } }),
    ]);

    return {
      ...negocio,
      // Mapa feature -> { habilitada, limite } para que la PWA Admin sepa que mostrar
      features: Object.fromEntries(
        features.map((f) => [f.feature, { habilitada: f.habilitada, limite: f.limite }]),
      ),
      sucursalesActivas,
    };
  }

  /** Endpoint publico por slug (PWA Cliente, sin auth). */
  async publicoPorSlug(slug: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { slug, activo: true },
      select: { ...PUBLICO },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const [config, sucursales] = await Promise.all([
      this.prisma.configuracionClub.findUnique({
        where: { negocioId: negocio.id },
        select: {
          modoFidelizacion: true, sellosParaPremio: true, premioTexto: true, menuActivo: true,
          tiposPedidoHabilitados: true, modosPagoHabilitados: true, mostrarResenaPostVisita: true,
          numeroAtendiente: true,
        },
      }),
      this.prisma.sucursal.findMany({
        where: { negocioId: negocio.id, activa: true },
        select: { id: true, nombre: true, slug: true, esPrincipal: true, direccion: true, telefono: true },
        orderBy: { esPrincipal: 'desc' },
      }),
    ]);

    return { ...negocio, configuracion: config, sucursales };
  }

  /** Los 2 QRs fijos (no hay modos de mesa). */
  async qrInfo(negocioId: string) {
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { slug: true, urlMenu: true, urlClub: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const base = process.env.PUBLIC_APP_URL ?? 'https://app.dominio.com';
    return {
      negocio: negocio.slug,
      qrMenu: { url: negocio.urlMenu ?? `${base}/${negocio.slug}/menu`, etiqueta: 'Menu / Carta' },
      qrClub: { url: negocio.urlClub ?? `${base}/${negocio.slug}/club`, etiqueta: 'Club de fidelizacion + resena' },
    };
  }

  async features(negocioId: string) {
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { plan: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    const features = await this.prisma.planFeature.findMany({ where: { plan: negocio.plan } });
    return {
      plan: negocio.plan,
      features: Object.fromEntries(features.map((f) => [f.feature, { habilitada: f.habilitada, limite: f.limite }])),
    };
  }

  async actualizar(negocioId: string, dto: ActualizarNegocioDto, ctx: { empleadoId?: string; ip?: string }) {
    const negocio = await this.prisma.negocio.update({
      where: { id: negocioId },
      data: { ...dto },
      select: { ...PUBLICO },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'negocio.actualizado', empleadoId: ctx.empleadoId,
      detalle: { campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return negocio;
  }
}
