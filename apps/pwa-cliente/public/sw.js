/**
 * Service worker BASE de la PWA Cliente.
 *
 * POR QUE EXISTE: el handler de push (`/sw-push.js`) ya estaba escrito y servido,
 * pero NINGUN service worker lo importaba. Sin un SW registrado no existe
 * `pushManager.subscribe()` y las notificaciones push no pueden funcionar.
 * Este SW minimo lo registra (el registro lo hace `<RegistroServiceWorker />`,
 * montado en el layout raiz, contra la ruta `/sw.js`).
 *
 * CACHE: a proposito NO cachea NADA. Un SW que cachea mal deja la app pegada en
 * una version vieja y es dificilisimo de diagnosticar (y de destrabar en el
 * celular del cliente). El handler de `fetch` es un passthrough implicito: NO
 * llama a `respondWith`, asi que el navegador resuelve cada request por la red
 * como si el SW no existiera. Existe solo para que la app cuente como instalable
 * (el navegador exige un handler de `fetch` para ofrecer "Instalar app").
 *
 * DESREGISTRAR (desde la consola del navegador, si alguna vez hace falta):
 *   navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
 *   caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
 * y recargar la pagina. Al ser network-only no hay cache que borrar.
 */

// El ciclo de PUSH (eventos `push` y `notificationclick`) vive aparte, en
// sw-push.js: importScripts permite tocarlo sin regenerar este SW.
importScripts('/sw-push.js');

// Toma el control cuanto antes: sin esto, en la primera visita el SW queda
// "waiting" y `navigator.serviceWorker.ready` no resuelve hasta cerrar todas las
// pestanas. Con skipWaiting + clients.claim queda activo de inmediato.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handler de `fetch` MINIMO. NO cachea ni intercepta: sin `respondWith` el
// navegador sigue su curso normal (red). Ver el encabezado.
self.addEventListener('fetch', () => {
  // Sin cache: network-only implicito.
});
