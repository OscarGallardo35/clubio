'use client'

import * as React from 'react'
import { ApiError } from '@repo/api-client'
import { clienteApi } from '@/lib/api'
import { useClienteStore } from '@/stores/clienteStore'
import { api } from '@/lib/api'

interface UseCliente {
  autenticado: boolean
  cargando: boolean
  /** true una vez que se sabe si hay sesion o no (evita parpadear el registro). */
  resuelto: boolean
  refetch: () => Promise<void>
  logout: () => Promise<void>
}

export function useCliente(): UseCliente {
  const { autenticado, cargando } = useClienteStore()
  const fijarSesion = useClienteStore((s) => s.fijarSesion)
  const limpiar = useClienteStore((s) => s.limpiar)
  const [resuelto, setResuelto] = React.useState(false)
  const [cargandoLocal, setCargandoLocal] = React.useState(false)

  const refetch = React.useCallback(async () => {
    setCargandoLocal(true)
    try {
      const me = await clienteApi.me()
      fijarSesion({
        cliente: me.cliente,
        tarjetas: me.tarjetas,
        sumoHoy: me.sumoHoy,
      })
    } catch (e) {
      // 401 = no hay sesion (es un estado valido, no un error de red).
      if (e instanceof ApiError && e.status === 401) limpiar()
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

  return { autenticado, cargando: cargando || cargandoLocal, resuelto, refetch, logout }
}
