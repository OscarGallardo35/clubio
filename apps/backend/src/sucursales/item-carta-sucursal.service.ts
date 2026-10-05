import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { OverrideItemCartaDto, BulkOverrideItemCartaDto } from './dto/override-item-carta.dto';

export interface CtxItemOverride { empleadoId: string; ip?: string }

@Injectable()
export class ItemCartaSucursalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async exigirSucursal(negocioId: string, sucursalId: string) {
    const s = await this.prisma.sucursal.findFirst({
      where: { id: sucursalId, negocioId }, select: { id: true, nombre: true },
    });
    if (!s) throw new NotFoundException('Sucursal no encontrada');
    return s;
  }

  private async exigirItems(negocioId: string, ids: string[]) {
    const items = await this.prisma.itemCarta.findMany({
      where: { id: { in: ids }, negocioId }, select: { id: true, nombre: true },
    });
    const faltan = ids.filter((id) => !items.some((i) => i.id === id));
    if (faltan.length) {
      throw new BadRequestException(`Estos items no existen o son de otro negocio: ${faltan.join(', ')}`);
    }
    return items;
  }

  /** Lista de overrides de una sucursal (con el item y su precio global). */
  async listar(negocioId: string, sucursalId: string) {
    await this.exigirSucursal(negocioId, sucursalId);
    const data = await this.prisma.itemCartaSucursal.findMany({
      where: { sucursalId },
      include: {
        itemCarta: { select: { id: true, nombre: true, precio: true, disponible: true, categoria: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });
    return {
      sucursalId,
      total: data.length,
      data: data.map((o) => ({
        id: o.id, itemCartaId: o.itemCartaId, itemNombre: o.itemCarta.nombre,
        categoria: o.itemCarta.categoria,
        precioGlobal: Number(o.itemCarta.precio), disponibleGlobal: o.itemCarta.disponible,
        precioOverride: o.precio !== null ? Number(o.precio) : null,
        disponibleOverride: o.disponible,
      })),
    };
  }

  async crearOActualizar(
    negocioId: string, sucursalId: string,
    dto: OverrideItemCartaDto, ctx: CtxItemOverride,
  ) {
    await this.exigirSucursal(negocioId, sucursalId);
    await this.exigirItems(negocioId, [dto.itemCartaId]);

    const override = await this.prisma.itemCartaSucursal.upsert({
      where: { itemCartaId_sucursalId: { itemCartaId: dto.itemCartaId, sucursalId } },
      update: {
        ...(dto.precio !== undefined ? { precio: dto.precio === null ? null : new Prisma.Decimal(dto.precio) } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
      },
      create: {
        itemCartaId: dto.itemCartaId, sucursalId,
        precio: dto.precio === undefined || dto.precio === null ? null : new Prisma.Decimal(dto.precio),
        disponible: dto.disponible ?? null,
      },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.item_override_creado', empleadoId: ctx.empleadoId,
      detalle: { sucursalId, itemCartaId: dto.itemCartaId, precio: dto.precio ?? null, disponible: dto.disponible ?? null },
      ip: ctx.ip,
    });
    return override;
  }

  /** Bulk en UNA transaccion: un override a medias deja la carta inconsistente. */
  async bulk(negocioId: string, sucursalId: string, dto: BulkOverrideItemCartaDto, ctx: CtxItemOverride) {
    await this.exigirSucursal(negocioId, sucursalId);
    const ids = [...new Set(dto.items.map((i) => i.itemCartaId))];
    if (ids.length !== dto.items.length) {
      throw new BadRequestException('Hay itemCartaId repetidos en el bulk');
    }
    await this.exigirItems(negocioId, ids);

    if (dto.reemplazar) {
      await this.prisma.itemCartaSucursal.deleteMany({
        where: { sucursalId, itemCartaId: { notIn: ids } },
      });
    }

    const resultados = await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.itemCartaSucursal.upsert({
        where: { itemCartaId_sucursalId: { itemCartaId: i.itemCartaId, sucursalId } },
        update: {
          ...(i.precio !== undefined ? { precio: i.precio === null ? null : new Prisma.Decimal(i.precio) } : {}),
          ...(i.disponible !== undefined ? { disponible: i.disponible } : {}),
        },
        create: {
          itemCartaId: i.itemCartaId, sucursalId,
          precio: i.precio === undefined || i.precio === null ? null : new Prisma.Decimal(i.precio),
          disponible: i.disponible ?? null,
        },
      })),
    );

    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.item_override_creado', empleadoId: ctx.empleadoId,
      detalle: { sucursalId, bulk: true, cantidad: resultados.length, reemplazar: !!dto.reemplazar }, ip: ctx.ip,
    });
    return { ok: true, sucursalId, procesados: resultados.length };
  }

  async eliminar(negocioId: string, sucursalId: string, itemCartaId: string, ctx: CtxItemOverride) {
    await this.exigirSucursal(negocioId, sucursalId);
    const r = await this.prisma.itemCartaSucursal.deleteMany({ where: { sucursalId, itemCartaId } });
    if (!r.count) throw new NotFoundException('Ese item no tiene override en esta sucursal');
    await this.auditoria.registrar({
      negocioId, accion: 'sucursal.item_override_eliminado', empleadoId: ctx.empleadoId,
      detalle: { sucursalId, itemCartaId }, ip: ctx.ip,
    });
    return { ok: true, sucursalId, itemCartaId };
  }
}