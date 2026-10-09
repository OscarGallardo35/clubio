'use client'

import * as React from 'react'

/**
 * Registra el service worker base (`/sw.js`).
 *
 * Se monta en el layout RAIZ para que corra en TODAS las rutas (incluida la carta
 * publica): sin un SW activo no existe `pushManager.subscribe()` y las
 * notificaciones no pueden funcionar. Es lo primero que faltaba: `sw-push.js`
 * ya estaba servido pero ningun SW lo importaba.
 *
 * Es idempotente (registrar dos veces el mismo scope no hace nada) y un fallo NO
 * rompe la app: se loguea y listo. No pide ningun permiso: registrar el SW es
 * independiente de la suscripcion a notificaciones.
 */
export function RegistroServiceWorker() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] no se pudo registrar el service worker', e)
    })
  }, [])

  return null
}
