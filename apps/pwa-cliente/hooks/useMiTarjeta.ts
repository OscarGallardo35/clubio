'use client'

/**
 * Trae la tarjeta del cliente (GET /visitas/mi-tarjeta).
 *
 * `habilitado` lo decide el que llama: sin sesion NO se pega (el backend contestaria 401 y ese 401
 * no es un error, es "no logueado").
 *
 * Se refresca solo cuando el staff aprueba una visita: el WS `visita:aprobada` dispara un refetch.
 * El WS necesita el token EN MEMORIA (la cookie es HttpOnly y el handshake no la lee desde JS).
 */
import * as React from 'react'
import { visitasApi } from '@/lib/api'
import { normalizarError } from '@/lib/checkout-maquina'
import { crearSocketVisitas } from '@/lib/socket'
import { useClienteStore } from '@/stores/clienteStore'
import type { MiTarjetaRespuesta } from '@/types/api'

export interface UsoMiTarjeta {
  tarjeta: MiTarjetaRespuesta | null
  cargando: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useMiTarjeta(sucursalSlug: string | null, habilitado: boolean): UsoMiTarjeta {
  const token = useClienteStore((s) => s.token)
  const [tarjeta, setTarjeta] = React.useState<MiTarjetaRespuesta | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(async () => {
    if (!habilitado) {
      setCargando(false)
      return
    }
    setCargando(true)
    try {
      const r = await visitasApi.miTarjeta(sucursalSlug)
      setTarjeta(r)
      setError(null)
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      // 401 = sin sesion (no es un error: el estado "no logueado" tiene su propia pantalla).
      if (status !== 401) setError(mensaje || 'No pudimos cargar tu tarjeta')
    } finally {
      setCargando(false)
    }
  }, [habilitado, sucursalSlug])

  React.useEffect(() => {
    void refetch()
  }, [refetch])

  React.useEffect(() => {
    if (!habilitado) return undefined
    const socket = crearSocketVisitas(token)
    socket.on('visita:aprobada', () => void refetch())
    return () => {
      socket.disconnect()
    }
  }, [habilitado, token, refetch])

  return { tarjeta, cargando, error, refetch }
}
