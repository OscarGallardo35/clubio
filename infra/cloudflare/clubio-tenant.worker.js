/**
 * clubio-tenant: subdominio por local -> ruta interna del cliente.
 *
 * `bar-la-esquina.clubio.lat/menu` se reescribe a `app.clubio.lat/bar-la-esquina/menu` y se devuelve
 * la respuesta como si fuera del subdominio: la URL que ve el navegador NO cambia, asi ningun link ya
 * compartido (QR impreso, WhatsApp, favoritos) se rompe.
 *
 * POR QUE EN EL BORDE: Railway no rutea dominios wildcard en este plan (probado: `*.clubio.lat`
 * registrado en el servicio devuelve 404 y ademas deja sin dominio a `app.clubio.lat`), asi que el
 * subdominio se resuelve en Cloudflare. El DNS `*.clubio.lat` (proxied) ya existe.
 *
 * Los hosts reservados (app, staff, admin, api, www) pasan SIN tocar: cada uno tiene su propio
 * servicio. Y los assets/API de Next tampoco se reescriben: `/_next/...` vive en la raiz del app, no
 * bajo `/[tenant]` (prefijarlos daba 404 en el css y los chunks).
 */
const RESERVADOS = new Set(['app', 'staff', 'admin', 'api', 'www', 'localhost']);
const DOMINIO = 'app.clubio.lat';
// Rutas de sesion del cliente: viven en la RAIZ del app, no bajo /[tenant].
const RUTAS_RAIZ = new Set(['historial', 'seleccionar-sucursal', 'offline', 'dev']);
// Assets, API e internos de Next: van al app tal cual, sin prefijo.
const SIN_REESCRITURA = /^\/(_next|api)\//;
const esAsset = (p) => SIN_REESCRITURA.test(p) || p === '/favicon.ico' || /\.[a-z0-9]+$/i.test(p);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const partes = host.split('.');
    const sub = partes.length >= 3 ? partes[0] : '';
    if (!sub || RESERVADOS.has(sub)) return fetch(request);

    const pathname = url.pathname;
    const primero = (pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    let path = pathname;
    if (esAsset(pathname)) {
      path = pathname;                                                   // sin prefijo
    } else if (primero !== sub && !RUTAS_RAIZ.has(primero)) {
      path = `/${sub}${pathname === '/' ? '/menu' : pathname}`;           // la raiz cae en el menu
    }

    const destino = new URL(request.url);
    destino.protocol = 'https:';
    destino.hostname = DOMINIO;
    destino.pathname = path;

    const headers = new Headers(request.headers);
    headers.set('x-clubio-tenant', sub);
    const tieneCuerpo = !['GET', 'HEAD'].includes(request.method);
    return fetch(new Request(destino.toString(), {
      method: request.method,
      headers,
      body: tieneCuerpo ? request.body : undefined,
      redirect: 'manual',
    }));
  },
};
