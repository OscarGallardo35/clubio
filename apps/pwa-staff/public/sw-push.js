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

/**
 * Resuelve a URL ABSOLUTA el destino del click.
 *
 * El backend ya manda URLs absolutas y con el slug del tenant (p. ej.
 * `https://staff.clubio.lat/que-lomitos/pedidos`), pero un SW queda cacheado en el
 * celular mucho mas tiempo que el backend: si llega una ruta relativa (payload viejo o
 * plantilla vieja), hay que resolverla contra el SCOPE del SW para que abra la app con
 * el tenant correcto y no una ruta relativa sin slug. Sin url se abre la app en su raiz.
 */
function resolverDestino(url) {
  const scope = self.registration.scope // absoluta y termina en '/'
  const limpia = typeof url === 'string' ? url.trim() : ''
  if (!limpia) return scope
  try {
    return new URL(limpia, scope).href // relativa -> contra el scope; absoluta -> tal cual
  } catch {
    return scope
  }
}

/** ¿La ventana ya esta en el destino (mismo origen y misma ruta)? */
function mismaRuta(actual, destino) {
  try {
    const a = new URL(actual)
    const b = new URL(destino)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    return actual === destino
  }
}

/** Enfoca una ventana, mejor esfuerzo (nunca rompe el handler). */
async function enfocar(cliente) {
  if (!cliente || !('focus' in cliente)) return
  try {
    await cliente.focus()
  } catch {
    // Algunos entornos no permiten focus(); igual queda abierta/navegada.
  }
}

/**
 * Click en la notificacion: SIEMPRE tiene que abrir o enfocar la app.
 *
 * Por orden:
 *  1. Hay una ventana ya en el destino -> solo `focus()`.
 *  2. Hay ventanas de la app en otra ruta -> navegar la primera y `focus()`.
 *  3. NO hay ninguna ventana (app CERRADA, o en Android instalada `matchAll` puede no
 *     devolver un cliente 'window') -> `openWindow(destino)`, que es lo unico que la
 *     abre. Este camino tambien cubre `navigate` no soportado.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = resolverDestino(event.notification.data?.url)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (ventanas) => {
      // 1) Ya hay una ventana en el destino: enfocar y listo.
      const exacta = ventanas.find((v) => mismaRuta(v.url, destino))
      if (exacta) {
        await enfocar(exacta)
        return
      }

      // 2) Hay ventanas de la app pero en otra ruta: reintentar reusar la primera.
      if (ventanas.length > 0) {
        const v = ventanas[0]
        let navego = false
        try {
          if ('navigate' in v) {
            await v.navigate(destino)
            navego = true
          }
        } catch {
          navego = false // navigate no soportado (PWA instalada en Android): se abre abajo
        }
        if (navego) {
          await enfocar(v)
          return
        }
        const abierta = await self.clients.openWindow(destino)
        await enfocar(abierta)
        return
      }

      // 3) Sin ventanas: abrir la app (unico camino que funciona con la PWA cerrada).
      const abierta = await self.clients.openWindow(destino)
      await enfocar(abierta)
    }),
  )
})
