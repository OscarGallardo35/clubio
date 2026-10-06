'use client'

/**
 * La carta de la sucursal activa (QR #1).
 *
 * - Lee de `useCarta` (cache de 5 min con stale-while-revalidate): aca no se hace fetch.
 * - Las categorias son un FILTRO; con una sola categoria o pocos items no hay tabs.
 * - Al tocar un item: si no tiene grupos de modificadores se agrega directo al carrito; si
 *   tiene, en el paso 2 se abre el modal. Por ahora los que tienen grupos avisan.
 *
 * Ojo con la decision del modal: la carta NO dice si un item tiene grupos (no viene en el
 * payload), asi que hay que preguntarle a los modificadores al tocar. Se usa el cache en
 * memoria para no pedir dos veces lo mismo.
 */
import * as React from 'react'
import { Skeleton, toast } from '@repo/ui'
import { CategoriaTabs } from './CategoriaTabs'
import { ItemCartaCard } from './ItemCartaCard'
import type { ItemDeCarta } from './ItemCartaCard'
import { useCarta } from '@/hooks/useCarta'
import { modificadoresApi } from '@/lib/api'
import { claveDeModificadores, normalizarModificadores } from '@/lib/modificadores-cache'
import { useModificadoresStore } from '@/stores/modificadoresStore'
import { useCarritoStore } from '@/stores/carritoStore'
import type { ItemCarta } from '@/lib/carrito-maquina'

export interface CartaDigitalProps {
  negocioSlug: string
  sucursalSlug: string | null
  sucursalId: string | null
  colorMarca?: string | undefined
}

interface CategoriaDeLaCarta {
  categoria: string
  items: ItemDeCarta[]
}

export function CartaDigital({ negocioSlug, sucursalSlug, sucursalId, colorMarca }: CartaDigitalProps) {
  const { carta, cargando, actualizando, aviso, descartarAviso } = useCarta(negocioSlug, sucursalSlug)
  const despachar = useCarritoStore((s) => s.despachar)
  const activarCarrito = useCarritoStore((s) => s.activar)
  const [categoria, setCategoria] = React.useState<string | null>(null)

  React.useEffect(() => {
    void activarCarrito(negocioSlug, sucursalId, sucursalSlug)
  }, [activarCarrito, negocioSlug, sucursalId, sucursalSlug])

  const categorias: CategoriaDeLaCarta[] = React.useMemo(
    () => (carta?.categorias ?? []).map((c) => ({ categoria: c.categoria, items: (c.items ?? []) as ItemDeCarta[] })),
    [carta],
  )
  const total = categorias.reduce((acc, c) => acc + c.items.length, 0)
  const mostrando = categoria ? categorias.filter((c) => c.categoria === categoria) : categorias

  const agregarDirecto = React.useCallback(
    (item: ItemDeCarta) => {
      const paraCarrito: ItemCarta = {
        id: item.id, nombre: item.nombre, precio: item.precio, disponible: item.disponible,
        ...(item.fotoUrl ? { imagenUrl: item.fotoUrl } : {}), grupos: [],
      }
      despachar({ tipo: 'AGREGAR_ITEM', item: paraCarrito, cantidad: 1, modificadores: [], notas: '' })
      toast.success(`${item.nombre} al carrito`)
    },
    [despachar],
  )

  const elegir = React.useCallback(
    async (item: ItemDeCarta) => {
      const store = useModificadoresStore.getState()
      const clave = claveDeModificadores(item.id)
      const cacheado = store.porClave[clave]
      const ahora = Date.now()
      if (cacheado && ahora - cacheado.guardadoEn < 5 * 60 * 1000) {
        if (cacheado.datos.grupos.length === 0) agregarDirecto(item)
        else toast(`"${item.nombre}" tiene opciones para elegir`)
        return
      }
      try {
        const datos = normalizarModificadores(await modificadoresApi.porItem(item.id))
        useModificadoresStore.getState().despachar({ tipo: 'FETCH_OK', clave, datos, ahora })
        if (datos.grupos.length === 0) agregarDirecto(item)
        else toast(`"${item.nombre}" tiene opciones para elegir`)
      } catch {
        // Si no se pudieron traer los grupos, se agrega igual: sumar un item no deberia
        // depender de un fetch que puede fallar.
        agregarDirecto(item)
      }
    },
    [agregarDirecto],
  )

  if (cargando && !carta) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {aviso ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
          <span>{aviso}</span>
          <button type="button" onClick={descartarAviso} className="underline">
            Entendido
          </button>
        </div>
      ) : null}

      {actualizando ? <p className="text-xs text-muted-foreground">Actualizando la carta...</p> : null}

      <CategoriaTabs categorias={categorias.map((c) => ({ nombre: c.categoria, cantidad: c.items.length }))} activa={categoria} onCambiar={setCategoria} />

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay items disponibles en esta sucursal.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {mostrando.flatMap((c) => c.items).map((item, i) => (
            <ItemCartaCard key={item.id} item={item} prioridad={i < 3} colorMarca={colorMarca} onElegir={(it) => void elegir(it)} />
          ))}
        </div>
      )}
    </div>
  )
}
