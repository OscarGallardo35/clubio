'use client'

import * as React from 'react'
import { ApiError } from '@repo/api-client'
import { clienteApi } from '@/lib/api'
import { useClienteStore } from '@/stores/clienteStore'
import type { ClienteBasico, TarjetaSucursal } from '@/types/api'
import { api } from '@/lib/api'
import { esTenantMismatch } from '@/lib/tenant'

interface UseCliente {
  /** Datos del cliente para mostrar (nombre en el saludo, tarjetas por sucursal). */
  cliente: ClienteBasico | null
  tarjetas: TarjetaSucursal[]
  autenticado: boolean
  cargando: boolean
  /** true una vez que se sabe si hay sesion o no (evita parpadear el registro). */
  resuelto: boolean
  /** true si la sesion guardada es de OTRO negocio (ver `esTenantMismatch`). */
  sesionDeOtroLocal: boolean
  refetch: () => Promise<void>
  logout: () => Promise<void>
}

export function useCliente(): UseCliente {
  const { autenticado, cargando, cliente, tarjetas } = useClienteStore()
  const fijarSesion = useClienteStore((s) => s.fijarSesion)
  const limpiar = useClienteStore((s) => s.limpiar)
  const [resuelto, setResuelto] = React.useState(false)
  const [cargandoLocal, setCargandoLocal] = React.useState(false)
  const [sesionDeOtroLocal, setSesionDeOtroLocal] = React.useState(false)

  const refetch = React.useCallback(async () => {
    setCargandoLocal(true)
    try {
      const me = await clienteApi.me()
      fijarSesion({
        cliente: me.cliente,
        tarjetas: me.tarjetas,
        sumoHoy: me.sumoHoy,
      })
      setSesionDeOtroLocal(false)
    } catch (e) {
      // 401 = no hay sesion (es un estado valido, no un error de red).
      if (e instanceof ApiError && e.status === 401) {
        limpiar()
        setSesionDeOtroLocal(false)
      } else if (
        e instanceof ApiError &&
        esTenantMismatch(e.status, (e as { message?: string }).message)
      ) {
        // La cookie es de otro negocio: no hay sesion utilizable aca. Se limpia lo que haya en
        // memoria y se marca para ofrecer "cambiar de cuenta" (la cookie la baja el logout).
        limpiar()
        setSesionDeOtroLocal(true)
      }
    } finally {
      setCargandoLocal(false)
      setResuelto(true)
    }
  }, [fijarSesion, limpiar])

  React.useEffect(() => {
    void refetch()
  }, [refetch])

  const logout = React.useCallback(async () => {
    try {
      await clienteApi.logout()
    } finally {
      limpiar()
      api.setToken(null)
      setResuelto(true)
    }
  }, [limpiar])

  return { cliente, tarjetas, autenticado, cargando: cargando || cargandoLocal, resuelto, sesionDeOtroLocal, refetch, logout }
}
