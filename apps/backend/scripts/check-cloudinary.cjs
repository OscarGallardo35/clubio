/**
 * Firma de subidas a Cloudinary (`POST /media/firmar-subida`).
 *
 *   pnpm --filter backend test:cloudinary
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:cloudinary
 *
 * Vigila las 3 cosas que hacen segura la subida DIRECTA (el binario va del navegador a Cloudinary,
 * el backend solo firma):
 *
 *   1. Sin credencial -> 401 (el guard de dueno).
 *   2. Con un dueno valido -> 200 y la forma correcta (timestamp en segundos, signature sha1 de 40,
 *      apiKey/cloudName, folder `clubio/<negocioId>/carta`, transformacion 800x800 limit + auto).
 *   3. La carpeta SIEMPRE cuelga del negocio del TOKEN: mandar un `negocioId` ajeno en el body NO
 *      devuelve una firma para ese otro negocio.
 *
 * Extras (si el entorno los permite):
 *   - la respuesta NUNCA filtra el `api_secret`;
 *   - la `signature` RECOMPUTADA con el secret local coincide con la del backend (prueba de que es
 *     una firma que Cloudinary aceptaria);
 *   - un ENCARGADO (no dueno) -> 403.
 *
 * Necesita `JWT_DUENO_SECRET` (firma el token a mano, como check-auth-dueno) y `CLOUDINARY_URL`
 * para los extras. Es un harness SIN efectos: no crea ni borra nada (firmar no sube nada).
 */
const { createHmac, randomUUID } = require('crypto');
const { v2: cloudinary } = require('cloudinary');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const SECRET_DUENO = process.env.JWT_DUENO_SECRET;
const SECRET_EMPLEADO = process.env.JWT_EMPLEADO_SECRET;

const prisma = new PrismaClient();
let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function firmar(payload, secret) {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${b64u(createHmac('sha256', secret).update(cuerpo).digest())}`;
}

async function req(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null } catch { data = texto; }
  return { status: res.status, data };
}

/** `cloudinary://<api_key>:<api_secret>@<cloud_name>`. Devuelve null si no aplica. */
function parsearCloudinaryUrl(url) {
  const limpia = (url ?? '').trim();
  if (!/^cloudinary:\/\//i.test(limpia)) return null;
  const s = limpia.replace(/^cloudinary:\/\//i, '');
  const at = s.lastIndexOf('@');
  if (at < 0) return null;
  const cred = s.slice(0, at);
  const cloudName = s.slice(at + 1);
  const sep = cred.indexOf(':');
  if (sep < 0) return null;
  return { apiKey: cred.slice(0, sep), apiSecret: cred.slice(sep + 1), cloudName };
}

(async () => {
  if (!SECRET_DUENO) {
    console.log('FALTA JWT_DUENO_SECRET en el entorno.');
    process.exit(2);
  }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!negocio) { console.log('No encontre el negocio del seed.'); process.exit(2); }
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { id: true, sucursalId: true },
  });
  if (!dueno) { console.log('No encontre un DUENO activo para el tenant.'); process.exit(2); }

  const token = firmar(
    {
      sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'DUENO',
      sucursalId: dueno.sucursalId, tipo: 'dueno', jti: randomUUID(),
    },
    SECRET_DUENO,
  );
  const cloud = parsearCloudinaryUrl(process.env.CLOUDINARY_URL);

  // 1) sin credencial -> el guard de dueno corta
  const anon = await req('POST', '/api/media/firmar-subida', {});
  chk('POST /media/firmar-subida sin token -> 401', anon.status === 401, `status=${anon.status}`);

  // 2) con dueno valido -> forma correcta
  const ok = await req('POST', '/api/media/firmar-subida', { tipo: 'carta' }, { Cookie: `dueno_token=${token}` });
  if (ok.status === 503) {
    console.log('\n  BLOQUEADO: el backend responde 503 (no tiene credenciales de Cloudinary).');
    console.log('  Carga CLOUDINARY_URL (o el trio CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET) en el');
    console.log('  servicio backend y volve a correr este harness.');
    await prisma.$disconnect();
    process.exit(3);
  }
  chk('con dueno valido -> 200/201', [200, 201].includes(ok.status), `status=${ok.status} ${JSON.stringify(ok.data?.message ?? '')}`);

  const f = ok.data ?? {};
  chk('timestamp en SEGUNDOS (10 digitos)', typeof f.timestamp === 'number' && String(f.timestamp).length === 10, String(f.timestamp));
  chk('signature: sha1 hex de 40', typeof f.signature === 'string' && /^[0-9a-f]{40}$/.test(f.signature), f.signature);
  chk('apiKey no vacio', typeof f.apiKey === 'string' && f.apiKey.length > 0);
  chk('cloudName no vacio', typeof f.cloudName === 'string' && f.cloudName.length > 0, f.cloudName);
  chk('folder = clubio/<negocioId>/carta', f.folder === `clubio/${negocio.id}/carta`, f.folder);
  chk(
    'transformation 800x800 limit + auto',
    ['c_limit', 'w_800', 'h_800', 'q_auto', 'f_auto'].every((p) => String(f.transformation).includes(p)),
    f.transformation,
  );

  // Extra: la respuesta no puede filtrar el secret.
  if (cloud?.apiSecret) {
    chk('la respuesta NO contiene el api_secret', !JSON.stringify(ok.data).includes(cloud.apiSecret));
    chk('apiKey == el de CLOUDINARY_URL', f.apiKey === cloud.apiKey);
    chk('cloudName == el de CLOUDINARY_URL', f.cloudName === cloud.cloudName);

    // Extra: la firma es VALIDA (recomputa con el secret; no se imprime el secret).
    // Vigila que el backend firme EXACTAMENTE los params que devuelve, recomputando con el MISMO
    // algoritmo del SDK (no a mano). Dos trampas que este chequeo ya cazo, las dos hacian fallar la
    // comparacion por razones ajenas al backend:
    //   1. Cloudinary firma `sha1(string_a_firmar + api_secret)`: el secret va AL FINAL. Con
    //      `createHmac('sha1', secret)` (secret primero) el hash es otro.
    //   2. Desde el `signature_version` 2 (el default del SDK) los valores se URL-encodean antes de
    //      firmar: una cadena armada a mano con las comas literales de la transformacion no coincide.
    const params = { folder: f.folder, timestamp: f.timestamp, transformation: f.transformation };
    const esperada = cloudinary.utils.api_sign_request(params, cloud.apiSecret);
    chk('la signature recomputada con el secret coincide', esperada === f.signature);
  } else {
    console.log('  (skip) sin CLOUDINARY_URL local: no se puede recomputar ni confirmar el secret');
  }

  // 3) la carpeta SIEMPRE es la del negocio del token (no la de otro negocio).
  const otro = await prisma.negocio.findFirst({ where: { id: { not: negocio.id } }, select: { id: true } });
  const idAjeno = otro?.id ?? 'cjx0negocioajeno0000000000';
  const cruzado = await req(
    'POST', '/api/media/firmar-subida', { tipo: 'carta', negocioId: idAjeno }, { Cookie: `dueno_token=${token}` },
  );
  chk(
    'con un negocioId ajeno en el body NO se firma para ese negocio',
    cruzado.data?.folder !== `clubio/${idAjeno}/carta`,
    `status=${cruzado.status} folder=${cruzado.data?.folder ?? '(sin folder)'}`,
  );
  chk('y el folder del token es el unico valido', f.folder === `clubio/${negocio.id}/carta`);

  // Extra: un ENCARGADO no firma (es un endpoint de dueno).
  if (SECRET_EMPLEADO) {
    const encargado = await prisma.empleado.findFirst({
      where: { negocioId: negocio.id, rol: 'ENCARGADO', activo: true, eliminadoEn: null },
      select: { id: true, sucursalId: true },
    });
    if (encargado) {
      const tEnc = firmar(
        { sub: encargado.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'ENCARGADO', sucursalId: encargado.sucursalId, tipo: 'empleado', jti: randomUUID() },
        SECRET_EMPLEADO,
      );
      const r = await req('POST', '/api/media/firmar-subida', { tipo: 'carta' }, { Cookie: `empleado_token=${tEnc}` });
      chk('un ENCARGADO (no dueno) -> 403', r.status === 403, `status=${r.status}`);
    }
  }

  await prisma.$disconnect();
  console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
