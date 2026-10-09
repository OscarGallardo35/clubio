'use client'

import * as React from 'react'

/**
 * Registra el service worker base (`/sw.js`) de la PWA Staff.
 *
 * Se monta en el layout RAIZ: sin un SW activo no existe `pushManager.subscribe()`
 * y las notificaciones de visitas/pedidos no pueden funcionar.
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
