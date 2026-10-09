#!/usr/bin/env node
/**
 * test:tenant-aislamiento — multi-tenant por path en las PWAs.
 *
 * Vigila lo que hace real al aislamiento: que el tenant viva en la URL y que una sesion de OTRO
 * negocio no pueda quedarse parada en la UI de un local que no es el suyo.
 *
 *   node scripts/check-tenant-aislamiento.cjs                     (contra produccion)
 *   STAFF_URL=http://127.0.0.1:3013 ADMIN_URL=... node scripts/... (contra un server local)
 *
 * Que chequea, por app (Staff y Admin):
 *   1. `/<tenant>/login` -> 200 (la pantalla del local).
 *   2. `/login` -> 200 y NO un 3xx: es la ruta del healthcheck de Railway, que rechaza un 3xx y deja
 *      el deploy en FAILED (ver TROUBLESHOOTING).
 *   3. Una ruta vieja sin slug (`/visitas`, `/carta`) -> 308 a `/<default>/...`.
 *   4. `/<tenant>/<ruta>` sin cookie -> 307 al login de ESE tenant, conservando la query en `volver`.
 *   5. **AISLAMIENTO**: la cookie de un negocio pidiendo la ruta de OTRO -> 307 al tenant de la cookie.
 *   6. Esa misma cookie en su propio tenant -> 200.
 *   7. La PWA Cliente sigue sirviendo la carta por path (`/<slug>/menu`) -> 200.
 *
 * La cookie se firma de verdad (HS256 con JWT_EMPLEADO_SECRET / JWT_DUENO_SECRET, que salen del
 * `.env`), y el token dice otro `negocioSlug` que el de la URL: es el caso que hay que bloquear.
 *
 * SIN efectos: solo hace requests GET/HEAD.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Sin dependencias: la PWA no tiene dotenv instalado, asi que los .env de la raiz se leen a mano.
function cargarEnv(archivo) {
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
cargarEnv(path.join(__dirname, '../../../.env'));
cargarEnv(path.join(__dirname, '../../../.env.secrets'));

const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT || 'bar-la-esquina';
const OTRO = 'otro-negocio-de-prueba';
const STAFF = (process.env.STAFF_URL || 'https://staff.clubio.lat').replace(/\/$/, '');
const ADMIN = (process.env.ADMIN_URL || 'https://admin.clubio.lat').replace(/\/$/, '');
const CLIENTE = (process.env.CLIENTE_URL || 'https://app.clubio.lat').replace(/\/$/, '');

let ok = 0;
const fallas = [];
function chk(nombre, cond, detalle = '') {
  if (cond) { ok++; console.log(`  OK    ${nombre}${detalle ? '   -> ' + detalle : ''}`); }
  else { fallas.push(nombre); console.log(`  FALLA ${nombre}${detalle ? '   -> ' + detalle : ''}`); }
}

function b64u(b) { return Buffer.from(b).toString('base64url'); }
function jwt(claims, secret) {
  if (!secret) return null;
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(claims))}`;
  return `${cuerpo}.${crypto.createHmac('sha256', secret).update(cuerpo).digest('base64url')}`;
}

async function head(url, cookie) {
  const r = await fetch(url, { method: 'GET', redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, location: r.headers.get('location') || '' };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = { negocioId: 'prueba', sucursalId: 'prueba', jti: 'aislamiento', iat: now, exp: now + 600 };
  const tokStaff = jwt({ ...base, sub: 'x', tipo: 'empleado', negocioSlug: OTRO, rol: 'MESERO' }, process.env.JWT_EMPLEADO_SECRET);
  const tokAdmin = jwt({ ...base, sub: 'x', tipo: 'dueno', negocioSlug: OTRO, rol: 'DUENO' }, process.env.JWT_DUENO_SECRET);

  for (const [app, url, tok, cookie, ruta] of [
    ['STAFF', STAFF, tokStaff, 'empleado_token', 'visitas'],
    ['ADMIN', ADMIN, tokAdmin, 'dueno_token', 'carta'],
  ]) {
    if (!tok) { console.log(`\n=== ${app} ===\n  (skip) falta el secret para firmar la cookie`); continue; }
    console.log(`\n=== ${app} (${url}) ===`);
    let r = await head(`${url}/${DEFAULT_TENANT}/login`);
    chk(`${app}: /<tenant>/login -> 200`, r.status === 200, String(r.status));

    r = await head(`${url}/login`);
    chk(`${app}: /login (healthcheck) -> 200 y NO 3xx`, r.status === 200, `${r.status}${r.location ? ' -> ' + r.location : ''}`);

    r = await head(`${url}/${ruta}`);
    chk(`${app}: /${ruta} sin slug -> 308 a /${DEFAULT_TENANT}/${ruta}`, r.status === 308 && (r.location || '').endsWith(`/${DEFAULT_TENANT}/${ruta}`), `${r.status} -> ${r.location}`);

    r = await head(`${url}/${DEFAULT_TENANT}/${ruta}?ref=ABC`);
    chk(`${app}: sin cookie -> 307 al login del tenant (con volver)`,
      r.status === 307 && (r.location || '').includes(`/${DEFAULT_TENANT}/login`) && (r.location || '').includes('volver='), `${r.status} -> ${r.location}`);

    r = await head(`${url}/${DEFAULT_TENANT}/${ruta}`, `${cookie}=${tok}`);
    chk(`${app}: AISLAMIENTO (cookie de ${OTRO}) -> 307 al tenant de la cookie`,
      r.status === 307 && (r.location || '').startsWith(`/${OTRO}`), `${r.status} -> ${r.location}`);

    r = await head(`${url}/${OTRO}/${ruta}`, `${cookie}=${tok}`);
    chk(`${app}: la misma cookie en SU tenant -> 200`, r.status === 200, String(r.status));

    r = await head(`${url}/`);
    chk(`${app}: raiz -> 307`, r.status === 307, `${r.status} -> ${r.location}`);
  }

  console.log(`\n=== CLIENTE (regresion del path) ===`);
  const rc = await head(`${CLIENTE}/${DEFAULT_TENANT}/menu`);
  chk(`CLIENTE: /<slug>/menu -> 200`, rc.status === 200, String(rc.status));

  console.log(`\nTOTAL: ${ok} OK, ${fallas.length} falla(s)`);
  if (fallas.length) { console.log('FALLARON:'); fallas.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.log('ERROR', e.message); process.exit(2); });
