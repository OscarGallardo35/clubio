'use client'

import { Separator } from '@repo/ui';
import type { ItemPedido } from '@/types/api';

/**
 * Items del pedido con sus modificadores y notas.
 *
 * "1x Milanesa - con Salsa BBQ, sin cebolla" + las notas entre comillas, como se
 * pidio. Los modificadores se agrupan por GRUPO (el backend guarda un registro por
 * opcion elegida), asi que dos opciones del mismo grupo van juntas.
 */
export function ItemsPedido({ items }: { items: ItemPedido[] }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-muted-foreground">El pedido no tiene items.</p>;
  }

  return (
    <ul className="divide-y">
      {items.map((it, idx) => {
        const porGrupo = new Map<string, string[]>();
        for (const m of it.modificadores ?? []) {
          const lista = porGrupo.get(m.grupoNombre) ?? [];
          lista.push(m.opcionNombre);
          porGrupo.set(m.grupoNombre, lista);
        }
        const detalle = [...porGrupo.values()].map((opciones) => opciones.join(' + ')).join(', ');

        return (
          <li key={`${it.itemId}-${idx}`} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {it.cantidad}x {it.nombre}
                {detalle ? <span className="font-normal text-muted-foreground"> - {detalle}</span> : null}
              </p>
              {it.notas ? (
                <p className="text-xs text-muted-foreground">&quot;{it.notas}&quot;</p>
              ) : null}
              {it.precioFinal > it.precioBase ? (
                <p className="text-xs text-muted-foreground">
                  base ${it.precioBase.toFixed(2)} + adicionales ${(it.precioFinal - it.precioBase).toFixed(2)}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-sm">${it.subtotal.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Subtotal + envio + total. El envio solo se muestra si existe. */
export function TotalesPedido({
  subtotal,
  costoEnvio,
  total,
}: {
  subtotal: number;
  costoEnvio: number | null;
  total: number;
}) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span>${subtotal.toFixed(2)}</span>
      </div>
      {costoEnvio !== null && costoEnvio > 0 ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Envio</span>
          <span>${costoEnvio.toFixed(2)}</span>
        </div>
      ) : null}
      <Separator />
      <div className="flex justify-between font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
