'use client'

import * as React from 'react'
import { endpoints } from '@repo/api-client'
import { api } from '@/lib/api'

/**
 * Suscripcion push para el DUENO (es un empleado con rol DUENO).
 *
 * Se usa para probar una plantilla en el propio dispositivo desde
 * /notificaciones: al suscribir aca, el endpoint del navegador queda registrado
 * y "Enviar prueba" le manda la notificacion.
 */
export type EstadoPush =
  | 'cargando'
  | 'no-soportado'
  | 'requiere-instalacion'
  | 'inactivo'
  | 'activo'
  | 'denegado'
  | 'error'

export interface UsoPushNotifications {
  estado: EstadoPush
  activo: boolean
  guardando: boolean
  mensaje: string | null
  /** Endpoint de la suscripcion activa (lo usa "Enviar prueba"). */
  endpoint: string | null
  activar: () => Promise<void>
}

function esIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
}

function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

function vapidABytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalizada = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalizada)
  const salida = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) salida[i] = raw.charCodeAt(i)
  return salida.buffer as ArrayBuffer
}

interface VapidRespuesta {
  publicKey: string
  habilitado: boolean
}

export function usePushNotifications(): UsoPushNotifications {
  const [estado, setEstado] = React.useState<EstadoPush>('cargando')
  const [guardando, setGuardando] = React.useState(false)
  const [mensaje, setMensaje] = React.useState<string | null>(null)
  const [endpoint, setEndpoint] = React.useState<string | null>(null)

  const soportado = React.useCallback((): boolean => {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  }, [])

  React.useEffect(() => {
    let vivo = true
    async function detectar() {
      if (!soportado()) {
        if (vivo) setEstado('no-soportado')
        return
      }
      if (esIOS() && !estaInstalada()) {
        if (vivo) setEstado('requiere-instalacion')
        return
      }
      if (Notification.permission === 'denied') {
        if (vivo) setEstado('denegado')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        if (!vivo) return
        const sub = await reg.pushManager.getSubscription()
        if (sub && Notification.permission === 'granted') {
          setEndpoint(sub.endpoint)
          setEstado('activo')
        } else {
          setEstado('inactivo')
        }
      } catch {
        if (vivo) setEstado('inactivo')
      }
    }
    void detectar()
    return () => {
      vivo = false
    }
  }, [soportado])

  const activar = React.useCallback(async () => {
    if (guardando) return
    setMensaje(null)

    if (!soportado()) {
      setEstado('no-soportado')
      return
    }
    if (esIOS() && !estaInstalada()) {
      setEstado('requiere-instalacion')
      return
    }

    setGuardando(true)
    try {
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready

      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'denegado' : 'inactivo')
        return
      }

      const vapid = await api.get<VapidRespuesta>(endpoints.push.vapidPublicKey)
      if (!vapid.habilitado || !vapid.publicKey) {
        setMensaje('El servidor no tiene configurado el envio de notificaciones (VAPID).')
        setEstado('error')
        return
      }

      // Reusa una suscripcion existente si el navegador ya tiene una.
      const existente = await reg.pushManager.getSubscription()
      const sub =
        existente ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidABytes(vapid.publicKey),
        }))

      const json = sub.toJSON()
      await api.post(endpoints.push.suscribirEmpleado, {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        userAgent: navigator.userAgent,
      })

      setEndpoint(sub.endpoint)
      setEstado('activo')
    } catch (e) {
      console.warn('[push] no se pudo activar', e)
      setMensaje(e instanceof Error ? e.message : 'No pudimos activar las notificaciones.')
      setEstado('error')
    } finally {
      setGuardando(false)
    }
  }, [guardando, soportado])

  return { estado, activo: estado === 'activo', guardando, mensaje, endpoint, activar }
}
