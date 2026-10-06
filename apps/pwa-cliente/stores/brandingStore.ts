'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { NegocioPublico } from '@/types/api'
import { STORAGE } from '@/lib/constants'
import { negocioApi } from '@/lib/api'

interface BrandingState {
  negocio: NegocioPublico | null
  cargando: boolean
  error: string | null
  /** Carga el negocio publico (con la config efectiva de la sucursal si se pasa). */
  cargar: (slug: string, sucursalSlug?: string | null) => Promise<NegocioPublico | null>
  /** Lo usa el layout del servidor para hidratar sin flash. */
  fijarInicial: (negocio: NegocioPublico) => void
  limpiar: () => void
}

/**
 * Se persiste a proposito: las rutas sin tenant en la URL (/tarjeta, /historial,
 * /seleccionar-sucursal) no pueden volver a pedir el negocio por slug, asi que
 * usan el ultimo visitado. El backend revalida todo igual.
 */
export const useBrandingStore = create<BrandingState>()(
  persist(
    (set) => ({
      negocio: null,
      cargando: false,
      error: null,

      cargar: async (slug, sucursalSlug) => {
        set({ cargando: true, error: null })
        try {
          const negocio = await negocioApi.publico(slug, sucursalSlug ?? null)
          set({ negocio, cargando: false })
          return negocio
        } catch (e) {
          const mensaje = e instanceof Error ? e.message : 'No pudimos cargar el local'
          set({ cargando: false, error: mensaje })
          return null
        }
      },

      fijarInicial: (negocio) => set({ negocio, cargando: false, error: null }),

      limpiar: () => set({ negocio: null, cargando: false, error: null }),
    }),
    {
      name: STORAGE.branding,
      storage: createJSONStorage(() => localStorage),
      // La hidratacion se dispara a mano desde el provider: en SSR no existe
      // localStorage y sin esto el primer render del cliente no coincide.
      skipHydration: true,
      partialize: (s) => ({ negocio: s.negocio }),
    },
  ),
)
