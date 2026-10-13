/**
 * Subida de fotos de carta: firma del PANEL DE PLATAFORMA + regresion del admin del DUENO.
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:superadmin-media
 *
 * El endpoint que faltaba: el panel (PWA Superadmin) administra VARIOS locales y el super-admin
 * no tiene tenant, asi que el `negocioId` va en el body y el guard es `SuperAdminGuard`
 * (`POST /superadmin/media/firmar-subida`). La firma es LA MISMA que la del dueno
 * (`MediaService.firmarSubida`): misma carpeta `clubio/<id>/carta`, misma transformacion.
 *
 * Que vigila, PUNTA A PUNTA y SIN relays (sube una imagen de verdad a Cloudinary y la persiste):
 *   A. PANEL
 *      1. La firma responde 200/201 con la forma correcta y la carpeta del local del body.
 *      2. El binario sube DIRECTO a Cloudinary y devuelve `secure_url`.
 *      3. La `fotoUrl` queda PERSISTIDA en el item y sale por el catalogo PUBLICO (lo que
 *         consume la PWA Cliente).
 *      4. AISLAMIENTO: sin cookie -> 401; cookie de OTRO contexto (`dueno_token` bien firmada,
 *         `cliente_token` bien firmada) -> 401.
 *   B. DUENO (regresion): login real del dueno del local de prueba, su `/media/firmar-subida`
 *      sigue 200/201 + subida + persistencia por SU endpoint de carta.
 *   C. Contrato del null: `colorPrimario: null` -> 400 con mensaje claro (nunca 500); hex -> 200.
 *
 * Efectos: crea un local de PRUEBA (slug `zz-media-*`) con un dueno y dos items de carta, sube
 * DOS imagenes de 1x1 y al final deshace TODO (borra los assets de Cloudinary y el local).
 * Limpia en `finally` incluso si un chequeo falla.
 *
 * Config (de `.env` / `.env.secrets`): `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`,
 * `SUPER_ADMIN_2FA_SECRET` (si el 2FA esta activo), `CLOUDINARY_URL`, `JWT_DUENO_SECRET` y
 * `JWT_CLIENTE_SECRET` (para forjar las cookies de los otros contextos).
 */
const fs = require('fs');
const path = require('path');
const { createHmac, randomUUID } = require('crypto');
const { v2: cloudinary } = require('cloudinary');
const speakeasy = require('speakeasy');

// dotenv-lite (sin dependencias): .env y .env.secrets de la raiz del monorepo.
const raiz = path.join(__dirname, '..', '..', '..');
for (const nombre of ['.env', '.env.secrets']) {
  const p = path.join(raiz, nombre);
  if (!fs.existsSync(p)) continue;
  for (const linea of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const API = process.env.API_URL || 'https://api.clubio.lat';
const EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim();
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD || '';
const SECRETO_2FA = process.env.SUPER_ADMIN_2FA_SECRET || null;
const SECRET_DUENO = process.env.JWT_DUENO_SECRET;
const SECRET_CLIENTE = process.env.JWT_CLIENTE_SECRET;

// PNG 1x1 transparente: el binario mas chico que Cloudinary acepta igual que una foto real.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
  return cond;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function firmarJwt(payload, secret) {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${b64u(createHmac('sha256', secret).update(cuerpo).digest())}`;
}

async function req(method, ruta, body, headers = {}) {
  const res = await fetch(API + ruta, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null } catch { data = texto; }
  return { status: res.status, data };
}

/** Sube el PNG 1x1 con una firma: multipart DIRECTO a Cloudinary (lo mismo que hace el browser). */
async function subirACloudinary(firma) {
  const fd = new FormData();
  fd.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'zz-media.png');
  fd.append('api_key', firma.apiKey);
  fd.append('timestamp', String(firma.timestamp));
  fd.append('signature', firma.signature);
  fd.append('folder', firma.folder);
  fd.append('transformation', firma.transformation);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${firma.cloudName}/image/upload`, { method: 'POST', body: fd });
  const datos = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, datos };
}

/** Cookie de sesion del panel: login (y 2FA si esta activo) por HTTP. */
async function sesionSuperAdmin() {
  const login = await req('POST', '/api/superadmin/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.data?.accessToken) return `superadmin_token=${login.data.accessToken}`;
  if (login.data?.requiere2FA) {
    if (!SECRETO_2FA) throw new Error('el login pide 2FA pero falta SUPER_ADMIN_2FA_SECRET');
    const codigo = speakeasy.totp({ secret: SECRETO_2FA, encoding: 'base32' });
    const dos = await req('POST', '/api/superadmin/auth/2fa', {
      challengeToken: login.data.challengeToken,
      codigo,
    });
    if (!dos.data?.accessToken) throw new Error(`2FA fallo: ${dos.status} ${JSON.stringify(dos.data)}`);
    return `superadmin_token=${dos.data.accessToken}`;
  }
  throw new Error(`login del super-admin fallo: ${login.status} ${JSON.stringify(login.data)}`);
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log('FALTAN SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD (.env.secrets).');
    process.exit(2);
  }
  if (!/^cloudinary:\/\//i.test((process.env.CLOUDINARY_URL ?? '').trim())) {
    console.log('FALTA CLOUDINARY_URL en el entorno: sin eso no se puede subir de verdad.');
    process.exit(2);
  }
  console.log(`API: ${API}\n`);

  const cookie = await sesionSuperAdmin();
  chk('login del super-admin -> sesion', cookie.startsWith('superadmin_token='));

  const base = await req('GET', '/api/superadmin/resumen', undefined, { Cookie: cookie });
  const localesAntes = base.data?.locales?.total ?? null;
  console.log(`  (base) /superadmin/resumen: locales=${localesAntes}`);

  const sello = Date.now().toString(36);
  const slug = `zz-media-${sello}`;
  const duenoEmail = `zz-media-dueno-${sello}@example.test`;
  const duenoPass = `Zz${sello}Pass!`;
  let negocioId = null;
  const assets = [];

  try {
    // ===== local de prueba ====================================================
    const creado = await req(
      'POST',
      '/api/superadmin/locales',
      { nombre: 'ZZ Media (prueba)', slug, plan: 'PRO', colorPrimario: '#123456', colorSecundario: '#654321' },
      { Cookie: cookie },
    );
    negocioId = creado.data?.id ?? null;
    chk('POST /superadmin/locales (local de prueba) -> 201', [200, 201].includes(creado.status), `status=${creado.status}`);
    if (!negocioId) throw new Error(`no se pudo crear el local de prueba: ${JSON.stringify(creado.data)}`);

    // ===== A. PANEL ===========================================================
    console.log('\n--- A. subida desde el PANEL (superadmin) ---');
    const firma = await req('POST', '/api/superadmin/media/firmar-subida', { negocioId, tipo: 'carta' }, { Cookie: cookie });
    chk('POST /api/superadmin/media/firmar-subida -> 200/201', [200, 201].includes(firma.status), `status=${firma.status} ${JSON.stringify(firma.data?.message ?? '')}`);
    const f = firma.data ?? {};
    chk('timestamp en SEGUNDOS (10 digitos)', typeof f.timestamp === 'number' && String(f.timestamp).length === 10, String(f.timestamp));
    chk('signature: sha1 hex de 40', typeof f.signature === 'string' && /^[0-9a-f]{40}$/.test(f.signature), f.signature);
    chk('apiKey/cloudName no vacios', Boolean(f.apiKey) && Boolean(f.cloudName), f.cloudName);
    chk('folder = clubio/<negocioId>/carta (el local del BODY)', f.folder === `clubio/${negocioId}/carta`, f.folder);
    chk(
      'transformation 800x800 limit + auto',
      ['c_limit', 'w_800', 'h_800', 'q_auto', 'f_auto'].every((p) => String(f.transformation).includes(p)),
      f.transformation,
    );

    const subida = await subirACloudinary(f);
    if (subida.datos?.public_id) assets.push(subida.datos.public_id);
    chk(
      'subida directa a Cloudinary -> 200 + secure_url',
      subida.ok && Boolean(subida.datos?.secure_url),
      `status=${subida.status} ${subida.datos?.error?.message ?? subida.datos?.secure_url ?? ''}`,
    );
    chk(
      'el public_id cuelga de la carpeta firmada',
      typeof subida.datos?.public_id === 'string' && subida.datos.public_id.startsWith(`clubio/${negocioId}/carta/`),
      subida.datos?.public_id ?? '(sin public_id)',
    );

    const item = await req(
      'POST',
      `/api/superadmin/locales/${negocioId}/carta/items`,
      { categoria: 'Pruebas', nombre: 'ZZ Media item', precio: 100, fotoUrl: subida.datos?.secure_url },
      { Cookie: cookie },
    );
    const itemId = item.data?.id ?? null;
    chk('POST .../carta/items con fotoUrl -> 201', [200, 201].includes(item.status), `status=${item.status}`);
    chk('el item devuelve la fotoUrl', item.data?.fotoUrl === subida.datos?.secure_url, item.data?.fotoUrl ?? '(sin fotoUrl)');

    const carta = await req('GET', `/api/superadmin/locales/${negocioId}/carta`, undefined, { Cookie: cookie });
    const guardado = (carta.data?.items ?? []).find((i) => i.id === itemId);
    chk('la fotoUrl quedo persistida (GET .../carta)', guardado?.fotoUrl === subida.datos?.secure_url, guardado?.fotoUrl ?? '(no aparece)');

    const publicaRes = await fetch(`${API}/api/carta`, { headers: { 'X-Tenant-Slug': slug } });
    const publica = await publicaRes.json().catch(() => null);
    // La carta publica viene AGRUPADA: `{ negocio, sucursal, total, categorias: [{ categoria, items }] }`.
    const planos = (publica?.categorias ?? []).flatMap((c) => c.items ?? []);
    const itemPublico = planos.find((i) => i.id === itemId);
    chk(
      'la carta PUBLICA (lo que ve el cliente) sirve la fotoUrl',
      Boolean(itemPublico) && itemPublico.fotoUrl === subida.datos?.secure_url,
      `${publicaRes.status} total=${publica?.total ?? '?'} ${itemPublico?.fotoUrl ?? '(no aparece)'}`,
    );
    console.log(`  URL publica del cliente: ${API}/api/carta  (X-Tenant-Slug: ${slug})`);

    // ===== 4. AISLAMIENTO =====================================================
    console.log('\n--- aislamiento entre paneles ---');
    const sinCookie = await req('POST', '/api/superadmin/media/firmar-subida', { negocioId });
    chk('sin cookie -> 401', sinCookie.status === 401, `status=${sinCookie.status}`);

    const ahora = Math.floor(Date.now() / 1000);
    if (SECRET_DUENO) {
      const tok = firmarJwt({ sub: randomUUID(), negocioId, negocioSlug: slug, rol: 'DUENO', sucursalId: 'x', tipo: 'dueno', exp: ahora + 600 }, SECRET_DUENO);
      const r = await req('POST', '/api/superadmin/media/firmar-subida', { negocioId }, { Cookie: `dueno_token=${tok}` });
      chk('cookie dueno_token (firmada con su secreto) -> 401', r.status === 401, `status=${r.status}`);
    }
    if (SECRET_CLIENTE) {
      const tok = firmarJwt({ sub: randomUUID(), negocioId, negocioSlug: slug, tipo: 'cliente', exp: ahora + 600 }, SECRET_CLIENTE);
      const r = await req('POST', '/api/superadmin/media/firmar-subida', { negocioId }, { Cookie: `cliente_token=${tok}` });
      chk('cookie cliente_token (firmada con su secreto) -> 401', r.status === 401, `status=${r.status}`);
    }
    const negocioAjeno = await req('POST', '/api/superadmin/media/firmar-subida', { negocioId: 'cjxnolocal00000000000000' }, { Cookie: cookie });
    chk('negocioId inexistente -> 404 (no firma a ciegas)', negocioAjeno.status === 404, `status=${negocioAjeno.status}`);

    // ===== C. contrato del null ==============================================
    console.log('\n--- contrato del null (colores NOT NULL) ---');
    const nulo = await req('PATCH', `/api/superadmin/locales/${negocioId}`, { colorPrimario: null }, { Cookie: cookie });
    chk('PATCH colorPrimario: null -> 400 (NO 500)', nulo.status === 400, `status=${nulo.status} ${JSON.stringify(nulo.data?.message ?? '')}`);
    chk(
      'y el mensaje explica que no se puede vaciar',
      JSON.stringify(nulo.data?.message ?? '').toLowerCase().includes('no se puede vaciar'),
      JSON.stringify(nulo.data?.message ?? ''),
    );
    const hex = await req('PATCH', `/api/superadmin/locales/${negocioId}`, { colorPrimario: '#0F172A' }, { Cookie: cookie });
    chk('PATCH colorPrimario: hex valido -> 200', hex.status === 200, `status=${hex.status}`);
    chk('y el color quedo guardado', hex.data?.colorPrimario === '#0F172A', hex.data?.colorPrimario ?? '(sin color)');
    const waNulo = await req('PATCH', `/api/superadmin/locales/${negocioId}`, { numeroAtendiente: null }, { Cookie: cookie });
    chk('PATCH numeroAtendiente: null sigue siendo 200 (borrar SI se puede)', waNulo.status === 200, `status=${waNulo.status}`);

    // ===== B. REGRESION DEL DUENO ============================================
    console.log('\n--- B. regresion del admin del DUENO (mismo local de prueba) ---');
    const emp = await req(
      'POST',
      `/api/superadmin/locales/${negocioId}/empleados`,
      { nombre: 'ZZ Dueno', rol: 'DUENO', email: duenoEmail, password: duenoPass },
      { Cookie: cookie },
    );
    chk('POST .../empleados (dueno del local de prueba) -> 201', [200, 201].includes(emp.status), `status=${emp.status}`);

    const loginDueno = await req('POST', '/api/auth/dueno/login', { email: duenoEmail, password: duenoPass, negocioSlug: slug });
    const tokenDueno = loginDueno.data?.accessToken ?? null;
    chk('login real del dueno -> accessToken', Boolean(tokenDueno), `status=${loginDueno.status}`);
    if (!tokenDueno) throw new Error(`login del dueno fallo: ${loginDueno.status} ${JSON.stringify(loginDueno.data)}`);

    const cookieDueno = `dueno_token=${tokenDueno}`;
    const firmaD = await req('POST', '/api/media/firmar-subida', { tipo: 'carta' }, { Cookie: cookieDueno });
    chk('POST /api/media/firmar-subida (dueno) -> 200/201', [200, 201].includes(firmaD.status), `status=${firmaD.status}`);
    chk('la carpeta sale del TOKEN (no del body)', firmaD.data?.folder === `clubio/${negocioId}/carta`, firmaD.data?.folder ?? '(sin folder)');

    const subidaD = await subirACloudinary(firmaD.data ?? {});
    if (subidaD.datos?.public_id) assets.push(subidaD.datos.public_id);
    chk('subida del dueno a Cloudinary -> 200 + secure_url', subidaD.ok && Boolean(subidaD.datos?.secure_url), `status=${subidaD.status}`);

    const itemD = await req(
      'POST',
      '/api/carta',
      { categoria: 'Pruebas', nombre: 'ZZ Dueno item', precio: 200, fotoUrl: subidaD.datos?.secure_url },
      { Cookie: cookieDueno, 'X-Tenant-Slug': slug },
    );
    chk('POST /api/carta (dueno, con su fotoUrl) -> 201', [200, 201].includes(itemD.status), `status=${itemD.status} ${JSON.stringify(itemD.data?.message ?? '')}`);
    chk('y la fotoUrl quedo persistida', itemD.data?.fotoUrl === subidaD.datos?.secure_url, itemD.data?.fotoUrl ?? '(sin fotoUrl)');
  } finally {
    // ===== limpieza: primero los assets, despues el local (cascade) ==========
    console.log('\n--- limpieza ---');
    for (const publicId of assets) {
      try {
        const borrado = await cloudinary.uploader.destroy(publicId);
        chk(`asset borrado de Cloudinary (${publicId})`, ['ok', 'not found'].includes(borrado?.result), borrado?.result ?? '(sin resultado)');
      } catch (e) {
        chk(`asset borrado de Cloudinary (${publicId})`, false, e.message);
      }
    }
    if (negocioId) {
      const baja = await req('DELETE', `/api/superadmin/locales/${negocioId}`, undefined, { Cookie: cookie });
      chk('local de prueba borrado (DELETE /superadmin/locales/:id)', [200, 201, 204].includes(baja.status), `status=${baja.status}`);
      const despues = await req('GET', '/api/superadmin/resumen', undefined, { Cookie: cookie });
      if (localesAntes !== null) {
        chk(
          '/superadmin/resumen volvio al valor de antes',
          despues.data?.locales?.total === localesAntes,
          `antes=${localesAntes} despues=${despues.data?.locales?.total}`,
        );
      }
    }
  }

  console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => {
  console.log('ERROR:', e.message);
  process.exit(1);
});
