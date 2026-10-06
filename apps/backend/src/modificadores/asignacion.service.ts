import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { ModificadoresService } from './modificadores.service';
import type { CtxMod } from './modificadores.service';
import type { AsignarGruposItemDto } from './dto/asignar-grupos-item.dto';
import type { AsignarBulkDto, DesasignarBulkDto } from './dto/asignar-bulk.dto';

@Injectable()
export class AsignacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly modificadores: ModificadoresService,
  ) {}

  /** Verifica que TODOS los ids existan en el negocio (aislamiento multitenant). */
  private async exigirItems(negocioId: string, itemIds: string[]) {
    const unicos = [...new Set(itemIds)];
    const items = await this.prisma.itemCarta.findMany({
      where: { negocioId, id: { in: unicos } }, select: { id: true, nombre: true },
    });
    if (items.length !== unicos.length) {
      const hallados = new Set(items.map((i) => i.id));
      const faltan = unicos.filter((id) => !hallados.has(id));
      throw new BadRequestException(
        `Item(s) inexistente(s) o de otro negocio: ${faltan.join(', ')}`,
      );
    }
    return items;
  }

  private async exigirGrupos(negocioId: string, grupoIds: string[]) {
    const unicos = [...new Set(grupoIds)];
    const grupos = await this.prisma.grupoModificador.findMany({
      where: { negocioId, id: { in: unicos } }, select: { id: true, nombre: true },
    });
    if (grupos.length !== unicos.length) {
      const hallados = new Set(grupos.map((g) => g.id));
      const faltan = unicos.filter((id) => !hallados.has(id));
      throw new BadRequestException(
        `Grupo(s) inexistente(s) o de otro negocio: ${faltan.join(', ')}`,
      );
    }
    return grupos;
  }

  async listarItemsConGrupos(negocioId: string, itemId?: string) {
    const items = await this.prisma.itemCarta.findMany({
      where: { negocioId, ...(itemId ? { id: itemId } : {}) },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }],
      select: {
        id: true, nombre: true, categoria: true, disponible: true,
        gruposModificadores: {
          orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
          select: {
            id: true, nombre: true, tipo: true, obligatorio: true,
            minSelecciones: true, maxSelecciones: true,
            _count: { select: { opciones: true } },
          },
        },
      },
    });
    if (itemId && !items.length) throw new NotFoundException('Item de carta no encontrado');
    return { data: items, total: items.length };
  }

  /**
   * G (#3.0): grupos de un item para la PWA Cliente (publico, sin auth).
   *
   * Solo lectura y solo datos de catalogo: nada de ids internos de negocio ni
   * de metricas. El negocio sale del TENANT (X-Tenant-Slug), nunca de un id que
   * mande el cliente.
   */
  async gruposDeItemPublico(negocioSlug: string, itemId: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { slug: negocioSlug, activo: true },
      select: { id: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const item = await this.prisma.itemCarta.findFirst({
      where: { id: itemId, negocioId: negocio.id, disponible: true },
      select: {
        id: true, nombre: true, precio: true,
        gruposModificadores: {
          orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
          select: {
            id: true, nombre: true, descripcion: true, tipo: true, obligatorio: true,
            minSelecciones: true, maxSelecciones: true,
            opciones: {
              where: { disponible: true },
              orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
              select: { id: true, nombre: true, precioExtra: true, disponible: true },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Item de carta no encontrado o no disponible');

    return {
      itemId: item.id,
      itemNombre: item.nombre,
      precioBase: item.precio,
      grupos: item.gruposModificadores,
    };
  }

  /** Asigna grupos a UN item. reemplazar=true borra las asignaciones previas. */
  async asignarAItem(negocioId: string, itemId: string, dto: AsignarGruposItemDto, ctx: CtxMod) {
    await this.exigirItems(negocioId, [itemId]);
    await this.exigirGrupos(negocioId, dto.grupoIds);

    const item = await this.prisma.itemCarta.update({
      where: { id: itemId },
      data: {
        gruposModificadores: dto.reemplazar
          ? { set: dto.grupoIds.map((id) => ({ id })) }
          : { connect: dto.grupoIds.map((id) => ({ id })) },
      },
      select: { id: true, nombre: true, gruposModificadores: { select: { id: true, nombre: true } } },
    });

    await this.modificadores.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.asignado_item', empleadoId: ctx.empleadoId,
      detalle: { itemId, grupos: dto.grupoIds, reemplazar: !!dto.reemplazar }, ip: ctx.ip,
    });
    return item;
  }

  /** Refinamiento 2: asignacion bulk, en una transaccion. */
  async bulkAsignar(negocioId: string, dto: AsignarBulkDto, ctx: CtxMod) {
    const items = await this.exigirItems(negocioId, dto.itemIds);
    await this.exigirGrupos(negocioId, dto.grupoIds);

    const reemplazar = dto.reemplazar ?? false;
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.itemCarta.update({
          where: { id: it.id },
          data: {
            gruposModificadores: reemplazar
              ? { set: dto.grupoIds.map((id) => ({ id })) }
              : { connect: dto.grupoIds.map((id) => ({ id })) },
          },
        }),
      ),
    );

    await this.modificadores.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.asignado_item', empleadoId: ctx.empleadoId,
      detalle: {
        bulk: true, items: dto.itemIds.length, grupos: dto.grupoIds.length,
        reemplazar,
      },
      ip: ctx.ip,
    });
    return { ok: true, items: items.length, grupos: dto.grupoIds.length, reemplazar };
  }

  async bulkDesasignar(negocioId: string, dto: DesasignarBulkDto, ctx: CtxMod) {
    const items = await this.exigirItems(negocioId, dto.itemIds);
    await this.exigirGrupos(negocioId, dto.grupoIds);

    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.itemCarta.update({
          where: { id: it.id },
          data: { gruposModificadores: { disconnect: dto.grupoIds.map((id) => ({ id })) } },
        }),
      ),
    );

    await this.modificadores.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.desasignado_item', empleadoId: ctx.empleadoId,
      detalle: { bulk: true, items: dto.itemIds.length, grupos: dto.grupoIds.length },
      ip: ctx.ip,
    });
    return { ok: true, items: items.length, grupos: dto.grupoIds.length };
  }
}