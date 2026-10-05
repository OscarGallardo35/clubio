import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import type { CrearItemCartaDto } from './dto/crear-item-carta.dto';
import type { ActualizarItemCartaDto } from './dto/actualizar-item-carta.dto';
import type { ReordenarCartaDto } from './dto/reordenar-carta.dto';
import type { FiltrarCartaDto } from './dto/filtrar-carta.dto';

export interface CartaCtx {
  empleadoId: string; rol: string; sucursalId?: string; ip?: string;
}

/** El precio es Decimal(10,2) en la DB; la API lo expone como number. */
function serializar<T extends { precio?: unknown }>(item: T) {
  return { ...item, precio: item.precio !== undefined ? Number(item.precio) : undefined };
}

@Injectable()
export class CartaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
  ) {}

  /**
   * Carta publica (QR #1). Solo items disponibles, agrupados por categoria.
   * Aplica el override de la sucursal resuelta (precio/disponibilidad).
   */
  async listarPublico(negocioSlug: string, filtros: FiltrarCartaDto) {
    // El endpoint publico no tiene JWT: el tenant llega como slug
    // (X-Tenant-Slug o subdominio) y aca se resuelve a negocioId.
    if (!negocioSlug) {
      throw new NotFoundException('Falta el tenant (X-Tenant-Slug) para servir la carta');
    }
    const negocio = await this.prisma.negocio.findUnique({
      where: { slug: negocioSlug.toLowerCase() },
      select: { id: true, nombre: true, slug: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    const negocioId = negocio.id;

    const sucursal = await this.resolver.resolverSucursal(negocioId, {
      sucursalId: filtros.sucursalId ?? null,
    });

    const items = await this.prisma.itemCarta.findMany({
      where: {
        negocioId,
        disponible: true,
        ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
        ...(filtros.search ? { nombre: { contains: filtros.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
      include: {
        overridesSucursal: { where: { sucursalId: sucursal.id as string } },
      },
    });

    const planos = items
      .map((it) => {
        const ov = it.overridesSucursal[0];
        const disponible = ov?.disponible ?? it.disponible;
        return serializar({
          id: it.id,
          categoria: it.categoria,
          nombre: it.nombre,
          descripcion: it.descripcion,
          precio: ov?.precio ?? it.precio,
          precioBase: it.precio,
          tieneOverride: !!ov,
          fotoUrl: it.fotoUrl,
          etiquetas: it.etiquetas,
          disponible,
          orden: it.orden,
        });
      })
      .filter((it) => it.disponible);

    return {
      negocio: { id: negocio.id, nombre: negocio.nombre, slug: negocio.slug },
      sucursal: { id: sucursal.id, nombre: sucursal.nombre, slug: sucursal.slug },
      total: planos.length,
      categorias: this.agrupar(planos),
    };
  }

  /** Carta admin: incluye no disponibles. */
  async listarAdmin(negocioId: string, filtros: FiltrarCartaDto) {
    const items = await this.prisma.itemCarta.findMany({
      where: {
        negocioId,
        ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
        ...(filtros.search ? { nombre: { contains: filtros.search, mode: 'insensitive' } } : {}),
        ...(filtros.disponible !== undefined ? { disponible: filtros.disponible === 'true' } : {}),
      },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
      include: { overridesSucursal: { include: { sucursal: { select: { id: true, nombre: true, slug: true } } } } },
    });

    const planos = items.map((it) =>
      serializar({
        ...it,
        overridesSucursal: it.overridesSucursal.map((o) => ({ ...o, precio: o.precio !== null ? Number(o.precio) : null })),
      }),
    );

    return { total: planos.length, categorias: this.agrupar(planos) };
  }

  private agrupar<T extends { categoria: string }>(items: T[]) {
    const mapa = new Map<string, T[]>();
    for (const it of items) {
      const lista = mapa.get(it.categoria) ?? [];
      lista.push(it);
      mapa.set(it.categoria, lista);
    }
    return [...mapa.entries()].map(([categoria, items]) => ({ categoria, items }));
  }

  async crear(negocioId: string, dto: CrearItemCartaDto, ctx: CartaCtx) {
    const item = await this.prisma.itemCarta.create({
      data: {
        negocioId,
        categoria: dto.categoria,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        precio: new Prisma.Decimal(dto.precio),
        fotoUrl: dto.fotoUrl ?? null,
        etiquetas: dto.etiquetas ?? [],
        disponible: dto.disponible ?? true,
        orden: dto.orden ?? 0,
      },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'carta.item_creado', empleadoId: ctx.empleadoId,
      detalle: { itemId: item.id, nombre: item.nombre }, ip: ctx.ip,
    });
    return serializar(item);
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarItemCartaDto, ctx: CartaCtx) {
    await this.exigirItem(negocioId, id);
    const item = await this.prisma.itemCarta.update({
      where: { id },
      data: {
        ...(dto.categoria !== undefined ? { categoria: dto.categoria } : {}),
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
        ...(dto.precio !== undefined ? { precio: new Prisma.Decimal(dto.precio) } : {}),
        ...(dto.fotoUrl !== undefined ? { fotoUrl: dto.fotoUrl } : {}),
        ...(dto.etiquetas !== undefined ? { etiquetas: dto.etiquetas } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.orden !== undefined ? { orden: dto.orden } : {}),
      },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'carta.item_actualizado', empleadoId: ctx.empleadoId,
      detalle: { itemId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return serializar(item);
  }

  /** Baja logica: el item queda no disponible (los pedidos historicos lo referencian). */
  async eliminar(negocioId: string, id: string, ctx: CartaCtx) {
    await this.exigirItem(negocioId, id);
    const item = await this.prisma.itemCarta.update({
      where: { id }, data: { disponible: false },
      select: { id: true, nombre: true, disponible: true },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'carta.item_desactivado', empleadoId: ctx.empleadoId,
      detalle: { itemId: id }, ip: ctx.ip,
    });
    return item;
  }

  async toggleDisponibilidad(negocioId: string, id: string, disponible: boolean, ctx: CartaCtx) {
    await this.exigirItem(negocioId, id);
    const item = await this.prisma.itemCarta.update({
      where: { id }, data: { disponible },
      select: { id: true, nombre: true, disponible: true },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'carta.disponibilidad_cambiada', empleadoId: ctx.empleadoId,
      detalle: { itemId: id, disponible }, ip: ctx.ip,
    });
    return item;
  }

  /** Batch update del orden en una sola transaccion. */
  async reordenar(negocioId: string, dto: ReordenarCartaDto, ctx: CartaCtx) {
    const ids = dto.items.map((i) => i.id);
    const propios = await this.prisma.itemCarta.findMany({
      where: { negocioId, id: { in: ids } }, select: { id: true },
    });
    if (propios.length !== ids.length) {
      throw new NotFoundException('Alguno de los items no pertenece a este negocio');
    }

    await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.itemCarta.update({ where: { id: i.id }, data: { orden: i.orden } })),
    );
    await this.auditoria.registrar({
      negocioId, accion: 'carta.reordenada', empleadoId: ctx.empleadoId,
      detalle: { items: dto.items.length }, ip: ctx.ip,
    });
    return { ok: true, actualizados: dto.items.length };
  }

  private async exigirItem(negocioId: string, id: string) {
    const item = await this.prisma.itemCarta.findFirst({ where: { id, negocioId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item de carta no encontrado');
    return item;
  }
}
