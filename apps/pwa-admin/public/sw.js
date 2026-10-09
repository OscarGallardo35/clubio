/**
 * Service worker BASE de la PWA Admin.
 *
 * Registra el handler de push (`/sw-push.js`) para que el dueno pueda probar las
 * notificaciones en su propio dispositivo desde /notificaciones. Sin un SW
 * registrado no existe `pushManager.subscribe()`.
 *
 * CACHE: no cachea NADA a proposito (un SW que cachea mal deja la app pegada en
 * una version vieja). El `fetch` es passthrough implicito.
 *
 * DESREGISTRAR (consola del navegador):
 *   navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
 */

importScripts('/sw-push.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // network-only implicito
});
