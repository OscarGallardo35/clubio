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
import { esTenantMismatch } from '@/lib/tenant'
import { crearSocketVisitas } from '@/lib/socket'
import { useClienteStore } from '@/stores/clienteStore'
import type { MiTarjetaRespuesta } from '@/types/api'

export interface UsoMiTarjeta {
  tarjeta: MiTarjetaRespuesta | null
  cargando: boolean
  error: string | null
  /** true si el 403 fue por sesion de OTRO negocio (ver `esTenantMismatch`). */
  tenantMismatch: boolean
  refetch: () => Promise<void>
}

export function useMiTarjeta(sucursalSlug: string | null, habilitado: boolean): UsoMiTarjeta {
  const token = useClienteStore((s) => s.token)
  const [tarjeta, setTarjeta] = React.useState<MiTarjetaRespuesta | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tenantMismatch, setTenantMismatch] = React.useState(false)

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
      setTenantMismatch(false)
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      // 401 = sin sesion (no es un error: el estado "no logueado" tiene su propia pantalla).
      // 403 por tenant: tampoco es un fallo de la app, es una sesion de otro local.
      if (esTenantMismatch(status, mensaje)) setTenantMismatch(true)
      if (status !== 401 && !esTenantMismatch(status, mensaje)) setError(mensaje || 'No pudimos cargar tu tarjeta')
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

  /**
   * Al VOLVER a la app, re-consultar la tarjeta.
   *
   * El WS `visita:aprobada` solo empuja mientras la app esta en primer plano: si el cliente la
   * manda al fondo (o el telefono se duerme) y despues abre la notificacion, el service worker
   * solo ENFOCA la ventana que ya estaba en `/tarjeta` (no la navega ni la recarga), asi que la
   * tarjeta seguia mostrando el saldo viejo — sin premio y sin el boton de canje. Re-consultar al
   * hacerse visible cierra ese hueco. No hay parpadeo: `cargando && !tarjeta` es el unico caso
   * que dibuja el esqueleto.
   */
  React.useEffect(() => {
    if (!habilitado) return undefined
    const alVolver = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [habilitado, refetch])

  return { tarjeta, cargando, error, tenantMismatch, refetch }
}
