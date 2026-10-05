import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { CrearReglaDto } from './dto/crear-regla.dto';
import type { ActualizarReglaDto } from './dto/actualizar-regla.dto';

export const CACHE_REGLAS = (negocioId: string) => `upsell:reglas:${negocioId}`;
export const TTL_REGLAS = 300; // 5 min

export interface CtxUpsell {
  empleadoId: string;
  ip?: string;
}

/** Regla tal como la consume el motor (cacheada). */
export interface ReglaCache {
  id: string;
  nombre: string;
  mensaje: string;
  prioridad: number;
  itemOrigenId: string | null;
  categoriaOrigen: string | null;
  itemDestinoId: string;
  maxVeces: number | null;
  soloUnaVez: boolean;
}

const SELECT_REGLA = {
  id: true, nombre: true, mensaje: true, activa: true, prioridad: true,
  itemOrigenId: true, categoriaOrigen: true, itemDestinoId: true,
  maxVeces: true, soloUnaVez: true, creadoEn: true,
  itemOrigen: { select: { id: true, nombre: true } },
  itemDestino: { select: { id: true, nombre: true, precio: true, disponible: true } },
} as const;

@Injectable()
export class UpsellService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async invalidarCache(negocioId: string) {
    await this.redis.del(CACHE_REGLAS(negocioId)).catch(() => undefined);
  }

  /** Reglas ACTIVAS ordenadas por prioridad DESC, cacheadas 5 min. */
  async reglasActivas(negocioId: string): Promise<ReglaCache[]> {
    const clave = CACHE_REGLAS(negocioId);
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) return JSON.parse(cacheado) as ReglaCache[];

    const reglas = await this.prisma.reglaUpsell.findMany({
      where: { negocioId, activa: true },
      orderBy: [{ prioridad: 'desc' }, { creadoEn: 'asc' }],
      select: {
        id: true, nombre: true, mensaje: true, prioridad: true,
        itemOrigenId: true, categoriaOrigen: true, itemDestinoId: true,
        maxVeces: true, soloUnaVez: true,
      },
    });

    await this.redis.set(clave, JSON.stringify(reglas), TTL_REGLAS).catch(() => undefined);
    return reglas;
  }

  private async validarRegla(
    negocioId: string,
    dto: { itemOrigenId?: string | null; categoriaOrigen?: string | null; itemDestinoId: string; maxVeces?: number | null; soloUnaVez?: boolean },
  ) {
    const tieneItem = !!dto.itemOrigenId;
    const tieneCat = !!dto.categoriaOrigen;
    if (tieneItem === tieneCat) {
      throw new BadRequestException('La regla necesita itemOrigenId O categoriaOrigen (exactamente uno)');
    }

    const ids = [dto.itemDestinoId, ...(dto.itemOrigenId ? [dto.itemOrigenId] : [])];
    const items = await this.prisma.itemCarta.findMany({
      where: { negocioId, id: { in: ids } },
      select: { id: true, nombre: true, disponible: true },
    });
    if (items.length !== ids.length) {
      throw new BadRequestException('Algun item de la regla no existe o es de otro negocio');
    }

    if (dto.itemOrigenId && dto.itemOrigenId === dto.itemDestinoId) {
      throw new BadRequestException('El item destino no puede ser el mismo que el de origen');
    }

    const destino = items.find((i) => i.id === dto.itemDestinoId);
    if (!destino?.disponible) {
      throw new BadRequestException(`El item destino "${destino?.nombre ?? ''}" no esta disponible`);
    }

    const soloUnaVez = dto.soloUnaVez ?? true;
    if (soloUnaVez && dto.maxVeces !== null && dto.maxVeces !== undefined && dto.maxVeces !== 1) {
      throw new BadRequestException('Si soloUnaVez es true, maxVeces debe ser 1 o no enviarse');
    }
  }

  /** Resuelve el negocio desde el slug del tenant (endpoint publico). */
  async negocioPorSlug(slug?: string | null): Promise<string> {
    if (!slug) throw new NotFoundException('Falta el tenant (X-Tenant-Slug) para esta operacion');
    const negocio = await this.prisma.negocio.findUnique({
      where: { slug: String(slug).toLowerCase() }, select: { id: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');
    return negocio.id;
  }

  async listar(negocioId: string) {
    const data = await this.prisma.reglaUpsell.findMany({
      where: { negocioId },
      orderBy: [{ prioridad: 'desc' }, { creadoEn: 'asc' }],
      select: SELECT_REGLA,
    });
    return { data, total: data.length };
  }

  async obtener(negocioId: string, id: string) {
    const regla = await this.prisma.reglaUpsell.findFirst({
      where: { id, negocioId }, select: SELECT_REGLA,
    });
    if (!regla) throw new NotFoundException('Regla de upsell no encontrada');
    return regla;
  }

  async crear(negocioId: string, dto: CrearReglaDto, ctx: CtxUpsell) {
    await this.validarRegla(negocioId, dto);

    const regla = await this.prisma.reglaUpsell.create({
      data: {
        negocioId,
        nombre: dto.nombre,
        mensaje: dto.mensaje,
        activa: dto.activa ?? true,
        prioridad: dto.prioridad ?? 0,
        itemOrigenId: dto.itemOrigenId ?? null,
        categoriaOrigen: dto.categoriaOrigen ?? null,
        itemDestinoId: dto.itemDestinoId,
        maxVeces: dto.maxVeces ?? null,
        soloUnaVez: dto.soloUnaVez ?? true,
      },
      select: SELECT_REGLA,
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'upsell.regla_creada', empleadoId: ctx.empleadoId,
      detalle: { reglaId: regla.id, nombre: regla.nombre }, ip: ctx.ip,
    });
    return regla;
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarReglaDto, ctx: CtxUpsell) {
    const actual = await this.prisma.reglaUpsell.findFirst({
      where: { id, negocioId },
      select: { id: true, itemOrigenId: true, categoriaOrigen: true, itemDestinoId: true, maxVeces: true, soloUnaVez: true },
    });
    if (!actual) throw new NotFoundException('Regla de upsell no encontrada');

    // Se valida el estado RESULTANTE (lo que no viene en el dto mantiene su valor)
    const resultante = {
      itemOrigenId: dto.itemOrigenId !== undefined ? dto.itemOrigenId : actual.itemOrigenId,
      categoriaOrigen: dto.categoriaOrigen !== undefined ? dto.categoriaOrigen : actual.categoriaOrigen,
      itemDestinoId: dto.itemDestinoId ?? actual.itemDestinoId,
      maxVeces: dto.maxVeces !== undefined ? dto.maxVeces : actual.maxVeces,
      soloUnaVez: dto.soloUnaVez !== undefined ? dto.soloUnaVez : actual.soloUnaVez,
    };
    await this.validarRegla(negocioId, resultante);

    const regla = await this.prisma.reglaUpsell.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.mensaje !== undefined ? { mensaje: dto.mensaje } : {}),
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
        ...(dto.prioridad !== undefined ? { prioridad: dto.prioridad } : {}),
        ...(dto.itemOrigenId !== undefined ? { itemOrigenId: dto.itemOrigenId } : {}),
        ...(dto.categoriaOrigen !== undefined ? { categoriaOrigen: dto.categoriaOrigen } : {}),
        ...(dto.itemDestinoId !== undefined ? { itemDestinoId: dto.itemDestinoId } : {}),
        ...(dto.maxVeces !== undefined ? { maxVeces: dto.maxVeces } : {}),
        ...(dto.soloUnaVez !== undefined ? { soloUnaVez: dto.soloUnaVez } : {}),
      },
      select: SELECT_REGLA,
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'upsell.regla_actualizada', empleadoId: ctx.empleadoId,
      detalle: { reglaId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return regla;
  }

  async eliminar(negocioId: string, id: string, ctx: CtxUpsell) {
    const regla = await this.prisma.reglaUpsell.findFirst({
      where: { id, negocioId }, select: { id: true, nombre: true },
    });
    if (!regla) throw new NotFoundException('Regla de upsell no encontrada');

    await this.prisma.reglaUpsell.delete({ where: { id } });
    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'upsell.regla_eliminada', empleadoId: ctx.empleadoId,
      detalle: { reglaId: id, nombre: regla.nombre }, ip: ctx.ip,
    });
    return { ok: true, eliminada: id };
  }
}