'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { SucursalPublica } from '@/types/api'
import { STORAGE } from '@/lib/constants'

/** De donde salio la sucursal activa (orden de prioridad del provider). */
export type OrigenSucursal = 'query' | 'storage' | 'jwt' | 'principal'

interface SucursalState {
  activa: SucursalPublica | null
  lista: SucursalPublica[]
  origen: OrigenSucursal | null
  /** Ultima eleccion del usuario, persistida por negocio. */
  eleccion: { negocioSlug: string; sucursalSlug: string } | null
  fijarLista: (lista: SucursalPublica[]) => void
  activar: (sucursal: SucursalPublica | null, origen: OrigenSucursal) => void
  /** Eleccion explicita del usuario (badge / pantalla de seleccion). */
  elegir: (negocioSlug: string, sucursal: SucursalPublica) => void
  limpiar: () => void
}

export const useSucursalStore = create<SucursalState>()(
  persist(
    (set) => ({
      activa: null,
      lista: [],
      origen: null,
      eleccion: null,

      fijarLista: (lista) => set({ lista }),

      activar: (sucursal, origen) => set({ activa: sucursal, origen }),

      elegir: (negocioSlug, sucursal) =>
        set({
          activa: sucursal,
          origen: 'storage',
          eleccion: { negocioSlug, sucursalSlug: sucursal.slug },
        }),

      limpiar: () => set({ activa: null, lista: [], origen: null }),
    }),
    {
      name: STORAGE.sucursal,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // Solo la eleccion: la lista y la activa se recalculan en cada carga.
      partialize: (s) => ({ eleccion: s.eleccion }),
    },
  ),
)
