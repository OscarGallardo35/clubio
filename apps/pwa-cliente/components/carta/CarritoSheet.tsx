'use client'

/**
 * Carrito, dentro de un BottomSheet.
 *
 * No guarda estado propio del carrito: todo sale de `carritoStore` y se modifica DESPACHANDO
 * (nunca mutando). El +/- usa `CAMBIAR_CANTIDAD`, que ya sabe que cantidad <= 0 saca la linea.
 *
 * El upsell viene de `useUpsell`, que ya tiene el debounce, el cache y el set de aceptadas: aca
 * solo se pintan 0-3 sugerencias y se avisa cuando una se acepta.
 */
import * as React from 'react'
import { BottomSheet, Button } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'
import { seleccionarTotal, useCarritoStore } from '@/stores/carritoStore'
import { useUpsell } from '@/hooks/useUpsell'
import { precioUnitario } from '@/lib/carrito-maquina'
import type { ItemCarrito, ItemCarta } from '@/lib/carrito-maquina'

export interface CarritoSheetProps {
  abierto: boolean
  onCerrar: () => void
  /** Se llama al tocar "Continuar al checkout" (el checkout es de un paso posterior). */
  onContinuar?: (() => void) | undefined
}

/** "con Salsa BBQ, Mayo" — vacio si el item no tiene nada elegido. */
export function textoModificadores(item: ItemCarrito): string {
  const nombres = item.modificadores.flatMap((m) => m.opciones.map((o) => o.nombre))
  return nombres.length > 0 ? `con ${nombres.join(', ')}` : ''
}

export function CarritoSheet({ abierto, onCerrar, onContinuar }: CarritoSheetProps) {
  const items = useCarritoStore((s) => s.items)
  const despachar = useCarritoStore((s) => s.despachar)
  const total = useCarritoStore(seleccionarTotal)
  const { sugerencias, aceptar, cargando, desactivado } = useUpsell(items)

  const vacio = items.length === 0
  // Con pocos items el sheet mide lo que necesita; con muchos, ocupa la pantalla para poder
  // scrollear comodo.
  const altura = items.length > 3 ? 'completa' : 'auto'

  const cambiar = (item: ItemCarrito, delta: number) =>
    despachar({ tipo: 'CAMBIAR_CANTIDAD', clave: item.clave, cantidad: item.cantidad + delta })

  const agregarSugerencia = (s: (typeof sugerencias)[number]) => {
    if (!s.itemId || !s.itemNombre || s.precio == null) return
    const item: ItemCarta = {
      id: s.itemId,
      nombre: s.itemNombre,
      precio: s.precio,
      disponible: true,
      // Las sugerencias son items sin modificadores: entran directo, sin modal.
      grupos: [],
    }
    despachar({ tipo: 'AGREGAR_ITEM', item, cantidad: 1, modificadores: [], notas: '' })
    aceptar(s.reglaId, s.itemId)
  }

  return (
    <BottomSheet abierto={abierto} onCerrar={onCerrar} titulo="Tu pedido" altura={altura}>
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto px-1 pb-2">
        {vacio ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Todavia no agregaste nada.</p>
        ) : (
          items.map((item) => {
            const mods = textoModificadores(item)
            return (
              <div key={item.clave} className="flex flex-col gap-1 border-b pb-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium leading-tight">
                      {item.cantidad > 1 ? `${item.cantidad}x ` : ''}
                      {item.nombre}
                    </p>
                    {mods ? <p className="text-sm text-muted-foreground">{mods}</p> : null}
                    {item.notas ? (
                      <p className="text-sm text-muted-foreground">"{item.notas}"</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 font-medium">{formatearPrecio(precioUnitario(item))}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Sacar uno de ${item.nombre}`}
                    onClick={() => cambiar(item, -1)}
                    className="size-10 p-0 text-lg leading-none"
                  >
                    -
                  </Button>
                  <span className="min-w-8 text-center tabular-nums" aria-live="polite">
                    {item.cantidad}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Agregar uno mas de ${item.nombre}`}
                    onClick={() => cambiar(item, 1)}
                    className="size-10 p-0 text-lg leading-none"
                  >
                    +
                  </Button>
                </div>
              </div>
            )
          })
        )}

        {!desactivado && sugerencias.length > 0 ? (
          <div className="mt-1 flex flex-col gap-2 rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">Sumale algo mas</p>
            {sugerencias.slice(0, 3).map((s) => (
              <div key={s.reglaId} className="flex items-center justify-between gap-2">
                <span className="text-sm">{s.mensaje || s.itemNombre}</span>
                <span className="flex items-center gap-2">
                  {s.precio != null ? (
                    <span className="text-sm text-muted-foreground">{formatearPrecio(s.precio)}</span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!s.itemId || !s.itemNombre}
                    onClick={() => agregarSugerencia(s)}
                  >
                    Agregar
                  </Button>
                </span>
              </div>
            ))}
            {cargando ? <p className="text-xs text-muted-foreground">Buscando sugerencias...</p> : null}
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-2 flex flex-col gap-2 border-t bg-background pt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-semibold">{formatearPrecio(total)}</span>
        </div>
        <Button
          type="button"
          onClick={() => {
            despachar({ tipo: 'ABRIR_CHECKOUT' })
            onContinuar?.()
          }}
          disabled={vacio}
          className="min-h-12 w-full"
        >
          Continuar al checkout
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => despachar({ tipo: 'LIMPIAR' })}
          disabled={vacio}
          className="w-full text-muted-foreground"
        >
          Vaciar carrito
        </Button>
      </div>
    </BottomSheet>
  )
}
