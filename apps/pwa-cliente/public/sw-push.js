/**
 * Handler de notificaciones push del service worker.
 *
 * Se mantiene aparte del SW principal (workbox/next-pwa lo genera) y se importa
 * con importScripts: asi el ciclo de push se toca sin regenerar el SW entero.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let datos = { titulo: 'Clubio', cuerpo: 'Tenés novedades', url: '/tarjeta' }
  try {
    datos = { ...datos, ...event.data.json() }
  } catch {
    datos.cuerpo = event.data.text()
  }

  const opciones = {
    body: datos.cuerpo,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: datos.url },
    tag: datos.tag || 'clubio',
    renotify: Boolean(datos.tag),
  }

  event.waitUntil(self.registration.showNotification(datos.titulo, opciones))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = event.notification.data?.url || '/tarjeta'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      // Si ya hay una pestaña abierta, se reusa en vez de abrir otra.
      for (const v of ventanas) {
        if ('focus' in v) {
          v.focus()
          if ('navigate' in v) v.navigate(destino)
          return undefined
        }
      }
      return self.clients.openWindow(destino)
    }),
  )
})
