'use client'

/**
 * Simuladores del carrito, para ver todos los estados sin armar la data a mano.
 *
 * Toca el store real a proposito: lo que se ve es el mismo componente que en la carta, con la
 * misma data y los mismos despachos. El unico estado local es el toggle de gating.
 *
 * ?estado=vacio | conItems | conModificadores | checkout
 */
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@repo/ui'
import { BadgeCarrito } from './carta/BadgeCarrito'
import { CarritoSheet } from './carta/CarritoSheet'
import { GatingBanner } from './carta/GatingBanner'
import { useCarritoStore } from '@/stores/carritoStore'
import { useUpsellStore } from '@/stores/upsellStore'
import { hashCarrito } from '@/lib/upsell-maquina'
import type { ItemCarta, ModificadorElegido } from '@/lib/carrito-maquina'
import type { SugerenciaUpsell } from '@/lib/carrito-maquina'

const ITEM_SIN_MODS: ItemCarta = { id: 'cmuvjy5ku002kbq7jjh4uwzph', nombre: 'Coca-Cola 500ml', precio: 1500, disponible: true, grupos: [] }
const ITEM_CON_MODS: ItemCarta = { id: 'cmuvjy5ku002kbq7jjh4uwzph', nombre: 'Hamburguesa clasica', precio: 4500, disponible: true, grupos: [] }

const MODS: ModificadorElegido[] = [
  {
    grupoId: 'dev-grupo-1',
    grupoNombre: 'Salsas obligatorias',
    opciones: [{ id: 'dev-op-bbq', nombre: 'BBQ', precioExtra: 200 }],
  },
]

const SUGERENCIAS: SugerenciaUpsell[] = [
  { reglaId: 'dev-1', mensaje: 'Sumale unas papas', motivo: 'dev', itemId: 'dev-papas', itemNombre: 'Papas fritas', precio: 1800 },
  { reglaId: 'dev-2', mensaje: 'Una cerveza bien fria', motivo: 'dev', itemId: 'dev-cerveza', itemNombre: 'Cerveza', precio: 2200 },
  { reglaId: 'dev-3', mensaje: 'De postre, flan', motivo: 'dev', itemId: 'dev-flan', itemNombre: 'Flan casero', precio: 1200 },
  { reglaId: 'dev-4', mensaje: 'Esta no deberia verse (4ta)', motivo: 'dev', itemId: 'dev-extra', itemNombre: 'Extra', precio: 100 },
]

export function DevCarrito() {
  const params = useSearchParams()
  const estado = params?.get('estado') ?? 'vacio'
  const items = useCarritoStore((s) => s.items)
  const despachar = useCarritoStore((s) => s.despachar)
  const [gating, setGating] = React.useState(false)
  const [sheet, setSheet] = React.useState(true)

  const agregarSin = () =>
    despachar({ tipo: 'AGREGAR_ITEM', item: ITEM_SIN_MODS, cantidad: 1, modificadores: [], notas: '' })

  const agregarCon = () =>
    despachar({ tipo: 'AGREGAR_ITEM', item: ITEM_CON_MODS, cantidad: 1, modificadores: MODS, notas: 'sin cebolla' })

  const cambiarSucursal = () =>
    despachar({ tipo: 'CAMBIAR_SUCURSAL', sucursalId: 'dev-sucursal-norte', sucursalSlug: 'norte' })

  /** Carga el cache del upsell con el hash ACTUAL del carrito, que es lo que mira sugerenciasVisibles. */
  const simularUpsell = () => {
    const hash = hashCarrito(items)
    useUpsellStore.getState().despachar({
      tipo: 'RESPUESTA',
      hash,
      sugerencias: SUGERENCIAS,
      motivo: 'dev',
      ahora: Date.now(),
    })
  }

  // ?estado= arma el carrito al entrar (y cada vez que cambia el query).
  React.useEffect(() => {
    if (estado === 'vacio') despachar({ tipo: 'LIMPIAR' })
    if (estado === 'conItems' || estado === 'checkout') {
      despachar({ tipo: 'LIMPIAR' })
      despachar({ tipo: 'AGREGAR_ITEM', item: ITEM_SIN_MODS, cantidad: 2, modificadores: [], notas: '' })
      despachar({ tipo: 'AGREGAR_ITEM', item: ITEM_CON_MODS, cantidad: 1, modificadores: MODS, notas: 'sin cebolla' })
    }
    if (estado === 'conModificadores') {
      despachar({ tipo: 'LIMPIAR' })
      despachar({ tipo: 'AGREGAR_ITEM', item: ITEM_CON_MODS, cantidad: 1, modificadores: MODS, notas: 'punto jugoso' })
    }
    if (estado === 'checkout') despachar({ tipo: 'ABRIR_CHECKOUT' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pb-24">
      <h1 className="text-lg font-semibold">dev/carrito</h1>
      <p className="text-sm text-muted-foreground">
        estado={estado} | items={items.length} | gating={gating ? 'on' : 'off'}
      </p>

      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={agregarSin}>Simular agregar item sin modificadores</Button>
        <Button variant="outline" onClick={agregarCon}>Simular agregar item con modificadores</Button>
        <Button variant="outline" onClick={cambiarSucursal}>Simular cambiar sucursal (vacia el carrito)</Button>
        <Button variant="outline" onClick={simularUpsell}>Simular upsell con sugerencias</Button>
        <Button variant={gating ? 'default' : 'outline'} onClick={() => setGating((g) => !g)}>
          Gating: {gating ? 'on' : 'off'}
        </Button>
        <Button variant="ghost" onClick={() => setSheet((s) => !s)}>Sheet: {sheet ? 'abierto' : 'cerrado'}</Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {['vacio', 'conItems', 'conModificadores', 'checkout'].map((e) => (
          <a key={e} href={`/dev/carrito?estado=${e}`} className="rounded border px-2 py-1 underline">
            ?estado={e}
          </a>
        ))}
      </div>

      {gating ? (
        <GatingBanner featureBloqueada="La carta digital" negocioNombre="Bar La Esquina" />
      ) : (
        <>
          <BadgeCarrito onClick={() => setSheet(true)} oculto={sheet} />
          <CarritoSheet abierto={sheet} onCerrar={() => setSheet(false)} />
        </>
      )}
    </div>
  )
}
