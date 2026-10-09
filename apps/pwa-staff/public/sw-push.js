/**
 * Handler de notificaciones push del service worker (PWA Staff).
 *
 * Se mantiene aparte del SW base (`sw.js`, que lo importa con importScripts) para
 * poder tocar el ciclo de push sin regenerar el SW entero.
 *
 * CLAVES DEL PAYLOAD: se aceptan `title`/`body` (lo que manda el backend) y
 * `titulo`/`cuerpo` (nombres historicos), para no depender del emisor.
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
    // Default pensado para el staff: la cola de pedidos.
    titulo: crudo.titulo ?? crudo.title ?? 'Clubio Staff',
    cuerpo: crudo.cuerpo ?? crudo.body ?? 'Tenés novedades',
    url: crudo.url ?? '/pedidos',
    icon: crudo.icon ?? crudo.icono ?? '/icons/icon-192.png',
    tag: crudo.tag,
  }

  const opciones = {
    body: datos.cuerpo,
    icon: datos.icon,
    badge: '/icons/badge-72.png',
    data: { url: datos.url },
    tag: datos.tag || 'clubio-staff',
    renotify: Boolean(datos.tag),
  }

  event.waitUntil(self.registration.showNotification(datos.titulo, opciones))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = event.notification.data?.url || '/pedidos'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      // Si ya hay una pestana abierta, se reusa en vez de abrir otra.
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
