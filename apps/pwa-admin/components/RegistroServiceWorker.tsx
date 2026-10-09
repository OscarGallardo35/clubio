'use client'

import * as React from 'react'

/** Registra el service worker base (`/sw.js`) de la PWA Admin (necesario para push). */
export function RegistroServiceWorker() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] no se pudo registrar el service worker', e)
    })
  }, [])

  return null
}
