'use client'

import * as React from 'react'
import { endpoints } from '@repo/api-client'
import { api } from '@/lib/api'

/**
 * Suscripcion a notificaciones push (PWA Cliente).
 *
 * Reglas de UX que respeta:
 * - NO pide permiso en la primera visita. Solo DETECTA el estado; el permiso se
 *   pide cuando el usuario toca "Activar notificaciones" (ver `activar`).
 * - En iOS el push solo funciona si la PWA esta INSTALADA en la pantalla de
 *   inicio (iOS 16.4+). Si no lo esta, el estado es 'requiere-instalacion' y la
 *   UI muestra "Instala la app primero..." en vez de pedir permiso.
 * - `navigator.serviceWorker.ready` es obligatorio: sin un SW activo no existe
 *   `pushManager`. El SW base lo registra <RegistroServiceWorker />.
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
  /** true cuando hay una suscripcion activa con permiso concedido. */
  activo: boolean
  guardando: boolean
  /** Mensaje de error legible (solo en 'error'). */
  mensaje: string | null
  /** Pide permiso, suscribe y registra la suscripcion en el backend. */
  activar: () => Promise<void>
}

/** iOS/iPadOS (el iPad moderno se hace pasar por Mac; se mira el touch). */
export function esIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
}

/** La PWA corre en modo standalone (instalada en la home screen). */
export function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

/** VAPID publica (base64url) -> ArrayBuffer, que es lo que acepta pushManager.subscribe.
 *  Se devuelve ArrayBuffer (no Uint8Array) porque el tipo generico de Uint8Array<ArrayBufferLike>
 *  no encaja en BufferSource con los libs de TS recientes. */
export function vapidABytes(base64: string): ArrayBuffer {
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

  const soportado = React.useCallback((): boolean => {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  }, [])

  // Deteccion SIN pedir permiso (nunca se llama a requestPermission aca).
  React.useEffect(() => {
    let vivo = true
    async function detectar() {
      if (!soportado()) {
        if (vivo) setEstado('no-soportado')
        return
      }
      // iOS sin instalar: no hay forma de suscribirse todavia.
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
        setEstado(sub && Notification.permission === 'granted' ? 'activo' : 'inactivo')
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
      // 1) SW activo: sin esto `pushManager` no existe.
      await navigator.serviceWorker.register('/sw.js')
      const reg = await navigator.serviceWorker.ready

      // 2) Permiso (recien aca, por accion explicita del usuario).
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'denegado' : 'inactivo')
        return
      }

      // 3) VAPID del backend. Si el local no lo tiene configurado, no se puede suscribir.
      const vapid = await api.get<VapidRespuesta>(endpoints.push.vapidPublicKey)
      if (!vapid.habilitado || !vapid.publicKey) {
        setMensaje('Este local todavia no tiene configurado el envio de notificaciones.')
        setEstado('error')
        return
      }

      // 4) Suscripcion real del navegador.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidABytes(vapid.publicKey),
      })

      // 5) Persistir en el backend (upsert por endpoint).
      const json = sub.toJSON()
      await api.post(endpoints.push.suscribir, {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        userAgent: navigator.userAgent,
      })

      setEstado('activo')
    } catch (e) {
      console.warn('[push] no se pudo activar', e)
      setMensaje(e instanceof Error ? e.message : 'No pudimos activar las notificaciones.')
      setEstado('error')
    } finally {
      setGuardando(false)
    }
  }, [guardando, soportado])

  return { estado, activo: estado === 'activo', guardando, mensaje, activar }
}
