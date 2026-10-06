'use client'

import { useSucursalCtx } from '@/components/SucursalProvider'
import type { OrigenSucursal } from '@/stores/sucursalStore'
import type { SucursalPublica } from '@/types/api'

interface UseSucursalActiva {
  sucursal: SucursalPublica | null
  sucursales: SucursalPublica[]
  origen: OrigenSucursal | null
  hayVarias: boolean
  cambiar: (sucursal: SucursalPublica) => void
  /** slug para los query params de la API (null = que el backend use la principal). */
  slugParaApi: string | null
  /** Texto corto para el badge, sin depender de si hay una o varias. */
  etiqueta: string
}

export function useSucursalActiva(): UseSucursalActiva {
  const { activa, lista, origen, hayVarias, cambiar } = useSucursalCtx()
  return {
    sucursal: activa,
    sucursales: lista,
    origen,
    hayVarias,
    cambiar,
    // Con una sola sucursal no tiene sentido mandar el slug: deja que el backend
    // resuelva la principal (y evita cachear de mas).
    slugParaApi: hayVarias && activa ? activa.slug : null,
    etiqueta: activa ? activa.nombre : 'Elegí tu local',
  }
}
