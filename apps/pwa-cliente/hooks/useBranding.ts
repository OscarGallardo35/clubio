'use client'

import { useBrandingCtx, type ModoBranding } from '@/components/BrandingProvider'
import type { ConfiguracionPublica, NegocioPublico } from '@/types/api'

interface UseBranding {
  negocio: NegocioPublico | null
  configuracion: ConfiguracionPublica | null
  features: string[]
  modo: ModoBranding
  cargando: boolean
  error: string | null
  tieneFeature: (feature: string) => boolean
  /** true solo cuando la carta esta disponible: feature + switch del negocio. */
  menuDisponible: boolean
  resenasDisponibles: boolean
}

export function useBranding(): UseBranding {
  const ctx = useBrandingCtx()
  return {
    negocio: ctx.negocio,
    configuracion: ctx.configuracion,
    features: ctx.features,
    modo: ctx.modo,
    cargando: ctx.cargando,
    error: ctx.error,
    tieneFeature: ctx.tieneFeature,
    // Gating visual: hace falta la feature del plan Y el switch del negocio.
    menuDisponible: ctx.tieneFeature('menu') && ctx.configuracion?.menuActivo === true,
    resenasDisponibles: ctx.configuracion?.mostrarResenaPostVisita === true && !!ctx.negocio?.placeId,
  }
}
