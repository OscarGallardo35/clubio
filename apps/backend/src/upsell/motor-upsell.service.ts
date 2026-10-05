import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { UpsellService } from './upsell.service';
import type { CalcularUpsellDto } from './dto/calcular-upsell.dto';
import type { SugerenciaUpsell } from './interfaces/sugerencia-upsell.interface';

/**
 * Motor de upsell: NO persiste nada, solo calcula sugerencias.
 * Se llama en cada cambio del carrito, por eso es publico y con rate limit.
 */
@Injectable()
export class MotorUpsellService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: SucursalResolverService,
    private readonly upsell: UpsellService,
  ) {}

  async calcular(negocioId: string, dto: CalcularUpsellDto) {
    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { upsellActivo: true, upsellMaxSugerencias: true },
    });
    if (!config?.upsellActivo) return { sugerencias: [], motivo: 'upsell desactivado' };

    const limite = dto.maxSugerencias ?? config.upsellMaxSugerencias ?? 3;

    // Reglas (cacheadas) + items del carrito en paralelo
    const carrito = dto.items ?? [];
    const idsCarrito = [...new Set(carrito.map((i) => i.itemId))];

    const [reglas, itemsCarrito] = await Promise.all([
      this.upsell.reglasActivas(negocioId),
      idsCarrito.length
        ? this.prisma.itemCarta.findMany({
            where: { negocioId, id: { in: idsCarrito } },
            select: { id: true, nombre: true, categoria: true },
          })
        : Promise.resolve([]),
    ]);

    if (!reglas.length || !itemsCarrito.length) return { sugerencias: [], motivo: 'sin reglas o carrito vacio' };

    // Cantidad total por item del carrito (para soloUnaVez / maxVeces)
    const cantidadPorItem = new Map<string, number>();
    for (const i of carrito) {
      cantidadPorItem.set(i.itemId, (cantidadPorItem.get(i.itemId) ?? 0) + i.cantidad);
    }
    const categoriasCarrito = new Set(itemsCarrito.map((i) => i.categoria));

    // Sucursal (opcional): para respetar el override de disponibilidad
    let sucursalId: string | null = null;
    if (dto.sucursalId || dto.sucursalSlug) {
      const s = await this.resolver.resolverSucursal(negocioId, {
        sucursalId: dto.sucursalId ?? null, sucursalSlug: dto.sucursalSlug ?? null,
      });
      sucursalId = s.id as string;
    }

    // Candidatas respetando condicion + soloUnaVez + maxVeces
    const candidatas: Array<{ reglaId: string; mensaje: string; destinoId: string; motivo: string }> = [];
    for (const r of reglas) {
      const matchea = r.itemOrigenId
        ? cantidadPorItem.has(r.itemOrigenId)
        : !!r.categoriaOrigen && categoriasCarrito.has(r.categoriaOrigen);
      if (!matchea) continue;

      const yaEnCarrito = cantidadPorItem.get(r.itemDestinoId) ?? 0;

      // soloUnaVez: no sugerir algo que el cliente ya puso
      if (r.soloUnaVez && yaEnCarrito > 0) continue;
      // maxVeces: cuantas unidades del destino ya hay en el carrito
      if (r.maxVeces !== null && yaEnCarrito >= r.maxVeces) continue;

      const origen = r.itemOrigenId
        ? itemsCarrito.find((i) => i.id === r.itemOrigenId)?.nombre
        : `los items de ${r.categoriaOrigen}`;

      candidatas.push({
        reglaId: r.id,
        mensaje: r.mensaje,
        destinoId: r.itemDestinoId,
        motivo: `Tu pedido incluye ${origen}`,
      });
    }

    if (!candidatas.length) return { sugerencias: [] };

    // Items destino, con override de disponibilidad/precio por sucursal
    const destinos = await this.prisma.itemCarta.findMany({
      where: { negocioId, id: { in: [...new Set(candidatas.map((c) => c.destinoId))] } },
      select: {
        id: true, nombre: true, precio: true, fotoUrl: true, categoria: true,
        etiquetas: true, disponible: true,
        overridesSucursal: sucursalId ? { where: { sucursalId }, select: { precio: true, disponible: true } } : false,
      },
    });
    const destinoPorId = new Map(destinos.map((d) => [d.id, d]));

    const sugerencias: SugerenciaUpsell[] = [];
    const destinosYaSugeridos = new Set<string>();
    for (const c of candidatas) {
      if (sugerencias.length >= limite) break;         // maxSugerencias
      if (destinosYaSugeridos.has(c.destinoId)) continue; // no repetir el mismo destino
      const d = destinoPorId.get(c.destinoId);
      if (!d) continue;

      const ov = Array.isArray(d.overridesSucursal) ? d.overridesSucursal[0] : undefined;
      if (!(ov?.disponible ?? d.disponible)) continue;  // filtrar no disponibles

      destinosYaSugeridos.add(c.destinoId);
      sugerencias.push({
        reglaId: c.reglaId,
        mensaje: c.mensaje,
        motivo: c.motivo,
        item: {
          id: d.id,
          nombre: d.nombre,
          precio: Number(ov?.precio ?? d.precio),
          fotoUrl: d.fotoUrl,
          categoria: d.categoria,
          etiquetas: d.etiquetas,
          disponible: true,
        },
      });
    }

    return { sugerencias, maxSugerencias: limite, evaluadas: reglas.length };
  }
}