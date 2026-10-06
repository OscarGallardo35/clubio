'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { STORAGE, PREFIJO_NEGOCIO } from '@/lib/constants'
import { precioConExtras } from '@/lib/dinero'

export interface OpcionElegida {
  opcionId: string
  nombre: string
  precioExtra: number
}

export interface GrupoElegido {
  grupoId: string
  grupoNombre: string
  opciones: OpcionElegida[]
}

export interface ItemCarrito {
  /** Clave de linea: el mismo item con distintos modificadores son lineas distintas. */
  lineaId: string
  itemId: string
  nombre: string
  precioBase: number
  cantidad: number
  modificadores: GrupoElegido[]
  notas?: string | undefined
}

interface CarritoState {
  items: ItemCarrito[]
  negocioSlug: string | null
  agregar: (item: Omit<ItemCarrito, 'lineaId' | 'cantidad'>, negocioSlug: string) => void
  cambiarCantidad: (lineaId: string, cantidad: number) => void
  quitar: (lineaId: string) => void
  limpiar: () => void
  subtotal: () => number
  cantidadTotal: () => number
}

/** Firma estable de los modificadores: dos lineas iguales se agrupan. */
function firma(items: GrupoElegido[]): string {
  return items
    .map((g) => `${g.grupoId}:${g.opciones.map((o) => o.opcionId).sort().join(',')}`)
    .sort()
    .join('|')
}

export const useCarritoStore = create<CarritoState>()(
  persist(
    (set, get) => ({
      items: [],
      negocioSlug: null,

      agregar: (item, negocioSlug) =>
        set((s) => {
          // El carrito es de un solo negocio: si cambia, se vacia.
          const base = s.negocioSlug === negocioSlug ? s.items : []
          const lineaId = `${item.itemId}#${firma(item.modificadores)}`
          const existente = base.find((i) => i.lineaId === lineaId)
          if (existente) {
            return {
              negocioSlug,
              items: base.map((i) => (i.lineaId === lineaId ? { ...i, cantidad: i.cantidad + 1 } : i)),
            }
          }
          return { negocioSlug, items: [...base, { ...item, lineaId, cantidad: 1 }] }
        }),

      cambiarCantidad: (lineaId, cantidad) =>
        set((s) => ({
          items:
            cantidad <= 0
              ? s.items.filter((i) => i.lineaId !== lineaId)
              : s.items.map((i) => (i.lineaId === lineaId ? { ...i, cantidad } : i)),
        })),

      quitar: (lineaId) => set((s) => ({ items: s.items.filter((i) => i.lineaId !== lineaId) })),

      limpiar: () => set({ items: [], negocioSlug: null }),

      subtotal: () =>
        get().items.reduce((acc, i) => {
          const unitario = precioConExtras(
            i.precioBase,
            i.modificadores.flatMap((g) => g.opciones.map((o) => o.precioExtra)),
          )
          return acc + unitario * i.cantidad
        }, 0),

      cantidadTotal: () => get().items.reduce((acc, i) => acc + i.cantidad, 0),
    }),
    {
      name: `${PREFIJO_NEGOCIO}:${STORAGE.carrito}`,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ items: s.items, negocioSlug: s.negocioSlug }),
    },
  ),
)
