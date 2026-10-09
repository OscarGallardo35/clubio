/**
 * Service worker BASE de la PWA Staff.
 *
 * Espejo del de la PWA Cliente (`apps/pwa-cliente/public/sw.js`): registra el
 * handler de push (`/sw-push.js`) que sin esto queda huerfano. Sin un SW
 * registrado no existe `pushManager.subscribe()`.
 *
 * CACHE: no cachea NADA a proposito (un SW que cachea mal deja la app pegada en
 * una version vieja). El `fetch` es passthrough implicito (no llama a
 * `respondWith`); existe solo para que la app cuente como instalable.
 *
 * DESREGISTRAR (consola del navegador):
 *   navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
 */

// El ciclo de push vive aparte para tocarlo sin regenerar este SW.
importScripts('/sw-push.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handler de fetch MINIMO: sin cache ni interceptacion.
self.addEventListener('fetch', () => {
  // network-only implicito
});
