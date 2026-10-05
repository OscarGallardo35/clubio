import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ItemInput, ItemPedido } from '../interfaces/pedido-item.interface';

const ETIQUETA_TIPO: Record<string, string> = {
  MESA: 'Mesa',
  TAKEAWAY: 'Retirar en local',
  DELIVERY: 'Delivery',
};

export const etiquetaTipo = (tipo: string) => ETIQUETA_TIPO[tipo] ?? tipo;

export interface ResultadoTotales {
  items: ItemPedido[];
  subtotal: number;
  costoEnvio: number;
  total: number;
}

/**
 * Recalcula TODO desde la base. Los precios que manda el cliente se ignoran
 * a proposito (evita manipulacion: alguien podria editar el JSON del navegador).
 *
 * Aplica el override de precio de ItemCartaSucursal de la sucursal del pedido
 * para que el precio cobrado sea el de esa sucursal.
 */
export async function calcularTotales(
  prisma: PrismaService,
  negocioId: string,
  sucursalId: string,
  items: ItemInput[],
  tipo: string,
  config: {
    costoEnvio: unknown;
    pedidoMinimoDelivery: unknown;
  },
): Promise<ResultadoTotales> {
  if (!items?.length) throw new BadRequestException('El pedido no tiene items');

  // Una sola query para todos los items (evita N+1)
  const ids = [...new Set(items.map((i) => i.itemId))];
  const encontrados = await prisma.itemCarta.findMany({
    where: { id: { in: ids }, negocioId },
    select: {
      id: true, nombre: true, precio: true, disponible: true,
      overridesSucursal: { where: { sucursalId }, select: { precio: true, disponible: true } },
    },
  });

  const porId = new Map(encontrados.map((i) => [i.id, i]));

  const inexistentes: string[] = [];
  const noDisponibles: string[] = [];
  for (const id of ids) {
    const it = porId.get(id);
    if (!it) { inexistentes.push(id); continue; }
    const ov = it.overridesSucursal[0];
    const disponible = ov?.disponible ?? it.disponible;
    if (!disponible) noDisponibles.push(it.nombre);
  }
  if (inexistentes.length) {
    throw new BadRequestException(
      `Item(s) inexistente(s) o de otro negocio: ${inexistentes.join(', ')}`,
    );
  }
  if (noDisponibles.length) {
    throw new BadRequestException(`Items no disponibles: ${noDisponibles.join(', ')}`);
  }

  const calculados: ItemPedido[] = items.map((input) => {
    const it = porId.get(input.itemId)!;
    const ov = it.overridesSucursal[0];
    const precioBase = Number(ov?.precio ?? it.precio);
    const modificadores: ItemPedido['modificadores'] = []; // #2.7
    const precioFinal = precioBase + modificadores.reduce((a, m) => a + m.precio, 0);
    const cantidad = Math.max(1, Math.floor(Number(input.cantidad) || 0));
    return {
      itemId: it.id,
      nombre: it.nombre,
      precioBase,
      precioFinal,
      cantidad,
      notas: input.notas,
      modificadores,
      subtotal: Number((precioFinal * cantidad).toFixed(2)),
    };
  });

  const subtotal = Number(calculados.reduce((a, i) => a + i.subtotal, 0).toFixed(2));

  let costoEnvio = 0;
  if (tipo === 'DELIVERY') {
    if (config.costoEnvio === null || config.costoEnvio === undefined) {
      throw new BadRequestException('Delivery no configurado: falta el costo de envio');
    }
    const minimo = config.pedidoMinimoDelivery !== null && config.pedidoMinimoDelivery !== undefined
      ? Number(config.pedidoMinimoDelivery) : null;
    if (minimo !== null && subtotal < minimo) {
      throw new BadRequestException(`El pedido minimo para delivery es $${minimo}`);
    }
    costoEnvio = Number(config.costoEnvio);
  }

  return {
    items: calculados,
    subtotal,
    costoEnvio,
    total: Number((subtotal + costoEnvio).toFixed(2)),
  };
}