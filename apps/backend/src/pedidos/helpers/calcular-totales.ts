
import { BadRequestException } from '@nestjs/common';
import { TipoModificador } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type {
  ItemInput, ItemPedido, ModificadorElegido,
} from '../interfaces/pedido-item.interface';

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
 * a proposito (evita manipulacion desde el navegador).
 *
 * Refinamiento 2 (anti N+1): UNA sola query trae todos los items del pedido con
 * sus grupos asignados y las opciones de cada grupo. La validacion de
 * modificadores se hace despues en memoria.
 *
 * `sucursalId` viene YA RESUELTO por pedidos.service (no se vuelve a resolver).
 */
export async function calcularTotales(
  prisma: PrismaService,
  negocioId: string,
  sucursalId: string,
  items: ItemInput[],
  tipo: string,
  config: { costoEnvio: unknown; pedidoMinimoDelivery: unknown },
): Promise<ResultadoTotales> {
  if (!items?.length) throw new BadRequestException('El pedido no tiene items');

  const ids = [...new Set(items.map((i) => i.itemId))];
  const encontrados = await prisma.itemCarta.findMany({
    where: { id: { in: ids }, negocioId },
    select: {
      id: true, nombre: true, precio: true, disponible: true,
      // Override de la sucursal del pedido
      overridesSucursal: { where: { sucursalId }, select: { precio: true, disponible: true } },
      // Grupos ASIGNADOS al item + sus opciones (una sola query)
      gruposModificadores: {
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
        select: {
          id: true, nombre: true, tipo: true, obligatorio: true,
          minSelecciones: true, maxSelecciones: true,
          opciones: { select: { id: true, nombre: true, precioExtra: true, disponible: true } },
        },
      },
    },
  });

  const porId = new Map(encontrados.map((i) => [i.id, i]));

  // ---- validacion de items ----
  const inexistentes: string[] = [];
  const noDisponibles: string[] = [];
  for (const id of ids) {
    const it = porId.get(id);
    if (!it) { inexistentes.push(id); continue; }
    const ov = it.overridesSucursal[0];
    if (!(ov?.disponible ?? it.disponible)) noDisponibles.push(it.nombre);
  }
  if (inexistentes.length) {
    throw new BadRequestException(
      `Item(s) inexistente(s) o de otro negocio: ${inexistentes.join(', ')}`,
    );
  }
  if (noDisponibles.length) {
    throw new BadRequestException(`Items no disponibles: ${noDisponibles.join(', ')}`);
  }

  // ---- validacion de modificadores + calculo ----
  const calculados: ItemPedido[] = items.map((input) => {
    const it = porId.get(input.itemId)!;
    const ov = it.overridesSucursal[0];
    const precioBase = Number(ov?.precio ?? it.precio);

    const asignados = new Map(it.gruposModificadores.map((g) => [g.id, g]));
    const elegidos: ModificadorElegido[] = [];
    const gruposConSeleccion = new Set<string>();

    for (const mod of input.modificadores ?? []) {
      const grupo = asignados.get(mod.grupoId);

      // 1) grupo no asignado al item
      if (!grupo) {
        throw new BadRequestException(
          `El grupo "${mod.grupoId}" no esta asignado al item "${it.nombre}"`,
        );
      }

      const opcionIds = mod.opcionIds ?? [];
      const opcionesDelGrupo = new Map(grupo.opciones.map((o) => [o.id, o]));

      // 2) opcion de otro grupo / inexistente
      for (const oid of opcionIds) {
        if (!opcionesDelGrupo.has(oid)) {
          throw new BadRequestException(
            `La opcion "${oid}" no pertenece al grupo "${grupo.nombre}"`,
          );
        }
      }

      // 3) UNICA_SELECCION: exactamente 1
      if (grupo.tipo === TipoModificador.UNICA_SELECCION && opcionIds.length !== 1) {
        throw new BadRequestException(
          `El grupo "${grupo.nombre}" admite exactamente 1 opcion (recibidas ${opcionIds.length})`,
        );
      }

      // 4) MULTIPLE_SELECCION: dentro de min/max
      if (grupo.tipo === TipoModificador.MULTIPLE_SELECCION) {
        if (opcionIds.length < grupo.minSelecciones) {
          throw new BadRequestException(
            `El grupo "${grupo.nombre}" necesita al menos ${grupo.minSelecciones} opcion(es)`,
          );
        }
        if (grupo.maxSelecciones !== null && opcionIds.length > grupo.maxSelecciones) {
          throw new BadRequestException(
            `El grupo "${grupo.nombre}" admite hasta ${grupo.maxSelecciones} opcion(es)`,
          );
        }
      }

      // 5) opciones no disponibles
      for (const oid of opcionIds) {
        const o = opcionesDelGrupo.get(oid)!;
        if (!o.disponible) {
          throw new BadRequestException(
            `La opcion "${o.nombre}" del grupo "${grupo.nombre}" no esta disponible`,
          );
        }
      }

      gruposConSeleccion.add(grupo.id);
      for (const oid of opcionIds) {
        const o = opcionesDelGrupo.get(oid)!;
        elegidos.push({
          grupoId: grupo.id,
          grupoNombre: grupo.nombre,
          opcionId: o.id,
          opcionNombre: o.nombre,
          precioExtra: Number(o.precioExtra),
        });
      }
    }

    // 6) grupos OBLIGATORIOS del item sin seleccion
    for (const g of it.gruposModificadores) {
      if (g.obligatorio && !gruposConSeleccion.has(g.id)) {
        throw new BadRequestException(`Falta seleccionar ${g.nombre}`);
      }
    }

    const sumaExtras = elegidos.reduce((a, m) => a + m.precioExtra, 0);
    const precioFinal = Number((precioBase + sumaExtras).toFixed(2));
    const cantidad = Math.max(1, Math.floor(Number(input.cantidad) || 0));

    return {
      itemId: it.id,
      nombre: it.nombre,
      precioBase,
      precioFinal,
      cantidad,
      notas: input.notas,
      modificadores: elegidos,
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
