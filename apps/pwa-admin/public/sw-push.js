/**
 * Handler de notificaciones push del service worker (PWA Admin).
 *
 * Se importa desde `sw.js` con importScripts. Acepta `title`/`body` (lo que manda
 * el backend) y `titulo`/`cuerpo` (nombres historicos).
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let crudo = {}
  try {
    crudo = event.data.json()
  } catch {
    crudo = { body: event.data.text() }
  }

  const datos = {
    titulo: crudo.titulo ?? crudo.title ?? 'Clubio',
    cuerpo: crudo.cuerpo ?? crudo.body ?? 'Tenés novedades',
    url: crudo.url ?? '/dashboard',
    icon: crudo.icon ?? crudo.icono ?? '/icons/icon-192.png',
    tag: crudo.tag,
  }

  const opciones = {
    body: datos.cuerpo,
    icon: datos.icon,
    badge: '/icons/badge-72.png',
    data: { url: datos.url },
    tag: datos.tag || 'clubio-admin',
    renotify: Boolean(datos.tag),
  }

  event.waitUntil(self.registration.showNotification(datos.titulo, opciones))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
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
