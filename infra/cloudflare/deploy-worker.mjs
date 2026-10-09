#!/usr/bin/env node
/**
 * Deploy del Worker `clubio-tenant` (subdominio por local -> ruta interna del cliente).
 *
 *   node infra/cloudflare/deploy-worker.mjs
 *
 * Por que existe: Railway NO rutea dominios wildcard en este plan. Se registró `*.clubio.lat` como
 * Custom Domain del servicio cliente y el borde contestaba 404 (y ademas dejaba sin dominio a
 * `app.clubio.lat` hasta restaurarlo). El subdominio se resuelve entonces en Cloudflare, con el DNS
 * `*.clubio.lat` (proxied) + este Worker + una ruta `*.clubio.lat/*`.
 *
 * Necesita en el .env: CLOUDFLARE_API_TOKEN (con Workers:Edit) y CLOUDFLARE_ACCOUNT_ID.
 * Si el token no tiene permiso, la API devuelve 403 y hay que agregarlo en el dashboard.
 *
 * DOS TRAMPAS que ya costaron tiempo:
 *   1. En el PUT del script, el campo del multipart tiene que llevar `filename=worker.js` explicito
 *      (coincidiendo con `main_module`): con curl en Windows, si se toma del path, Cloudflare busca un
 *      modulo llamado con la ruta completa y falla con "No such module: worker.js".
 *   2. La ruta `*.clubio.lat/*` tambien matchea app/staff/admin/api: el Worker hace PASSTHROUGH
 *      (fetch(request)) para esos hosts, que tienen su propio servicio.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const raiz = join(aquí, '..', '..');

function env(archivo) {
  const out = {};
  try {
    for (const l of readFileSync(join(raiz, archivo), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}
const cfg = { ...env('.env'), ...env('.env.secrets') };
const token = cfg.CLOUDFLARE_API_TOKEN;
const acc = cfg.CLOUDFLARE_ACCOUNT_ID;
const zona = cfg.CLOUDFLARE_ZONE_ID;
if (!token || !acc || !zona) { console.error('faltan CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_ZONE_ID'); process.exit(1); }

const script = readFileSync(join(aquí, 'clubio-tenant.worker.js'), 'utf8');
const meta = JSON.stringify({ main_module: 'worker.js', compatibility_date: '2024-11-01' });
const fd = new FormData();
fd.set('metadata', new Blob([meta], { type: 'application/json' }));
fd.set('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');

const put = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/workers/scripts/clubio-tenant`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: fd,
});
const resPut = await put.json();
console.log('deploy:', resPut.success, JSON.stringify(resPut.errors || []));
if (!resPut.success) process.exit(1);

const ruta = await fetch(`https://api.cloudflare.com/client/v4/zones/${zona}/workers/routes`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ pattern: '*.clubio.lat/*', script: 'clubio-tenant' }),
});
const resRuta = await ruta.json();
console.log('ruta:', JSON.stringify(resRuta.result || resRuta.errors));
