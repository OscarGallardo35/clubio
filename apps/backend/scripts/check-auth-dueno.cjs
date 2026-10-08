/**
 * Auth del DUENO (PWA Admin): `GET /auth/dueno/me` + la cookie HttpOnly `dueno_token`.
 *
 *   pnpm --filter backend test:auth-dueno
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:auth-dueno
 *
 * Dos caminos a proposito:
 *
 *   1. Token FIRMADO a mano (sin login): es la via del harness y la que prueba el GUARD — la
 *      cookie `dueno_token` y el header Bearer tienen que dar lo mismo, un token de OTRO contexto
 *      (empleado) no puede entrar, y sin credencial es 401.
 *   2. LOGIN COMPLETO con el dueno DEMO del seed (`carlos@barlaesquina.com` / `dueno123456`, sin
 *      2FA): es lo unico que prueba que el `Set-Cookie` sale con las banderas correctas. Son
 *      credenciales de un negocio de demo, publicas en `apps/backend/prisma/seed.ts`.
 *
 * Necesita `JWT_DUENO_SECRET`; usa `JWT_EMPLEADO_SECRET` si esta, para la prueba cruzada.
 * El `Domain=.clubio.lat` solo se exige en produccion (lo pone COOKIE_DOMAIN).
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const SECRET = process.env.JWT_DUENO_SECRET;
const SECRET_EMPLEADO = process.env.JWT_EMPLEADO_SECRET;
const EMAIL_DEMO = process.env.EMAIL_DUENO_DEMO || 'carlos@barlaesquina.com';
const PASSWORD_DEMO = process.env.PASSWORD_DUENO_DEMO || 'dueno123456';

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
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const setCookie = [...cookies, res.headers.get('set-cookie') ?? ''].filter(Boolean).join(' | ');
  return { status: res.status, data, setCookie };
}

(async () => {
  if (!SECRET) {
    console.log('FALTA JWT_DUENO_SECRET en el entorno.');
    process.exit(2);
  }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { id: true, nombre: true, email: true, sucursalId: true },
  });
  if (!dueno) {
    console.log('No encontre un DUENO activo para el tenant.');
    process.exit(2);
  }
  const token = firmar(
    {
      sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'DUENO',
      sucursalId: dueno.sucursalId, tipo: 'dueno', jti: randomUUID(),
    },
    SECRET,
  );

  // 1) sin credencial
  const anon = await req('GET', '/api/auth/dueno/me');
  chk('GET /auth/dueno/me sin credencial -> 401', anon.status === 401, `status=${anon.status}`);

  // 2) con la COOKIE dueno_token (la via principal de la PWA Admin)
  const conCookie = await req('GET', '/api/auth/dueno/me', undefined, { Cookie: `dueno_token=${token}` });
  chk('con la cookie dueno_token -> 200', conCookie.status === 200, `status=${conCookie.status} ${JSON.stringify(conCookie.data?.message ?? '')}`);
  chk(
    'devuelve dueno { id, nombre, email }',
    !!conCookie.data?.dueno?.id && typeof conCookie.data?.dueno?.email === 'string',
    JSON.stringify(conCookie.data?.dueno ?? null),
  );
  chk(
    'devuelve negocio con slug + features del plan',
    !!conCookie.data?.negocio?.slug && !!conCookie.data?.negocio?.features,
    `slug=${conCookie.data?.negocio?.slug} features=${Object.keys(conCookie.data?.negocio?.features ?? {}).length}`,
  );
  chk(
    'el negocio NO trae campos de administracion (es el shape publico)',
    conCookie.data?.negocio?.passwordHash === undefined && conCookie.data?.negocio?.plan !== undefined,
  );

  // 3) con el Bearer (compatibilidad: harness y llamadas server-to-server)
  const conBearer = await req('GET', '/api/auth/dueno/me', undefined, { Authorization: `Bearer ${token}` });
  chk('con Bearer -> 200 (la misma sesion por otra via)', conBearer.status === 200, `status=${conBearer.status}`);

  // 4) token de OTRO contexto: firmado con el secreto de empleado -> no cruza
  if (SECRET_EMPLEADO) {
    const cruzado = firmar(
      { sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'DUENO', tipo: 'empleado', jti: randomUUID() },
      SECRET_EMPLEADO,
    );
    const r = await req('GET', '/api/auth/dueno/me', undefined, { Cookie: `dueno_token=${cruzado}` });
    chk('token de empleado en la cookie de dueno -> 401', r.status === 401, `status=${r.status}`);
    const r2 = await req('GET', '/api/auth/dueno/me', undefined, { Cookie: `empleado_token=${cruzado}` });
    chk('y con el nombre de OTRA cookie -> 401 (no se lee cualquier cookie)', r2.status === 401, `status=${r2.status}`);
  }

  // 5) login con credenciales invalidas: no emite sesion NI cookie
  // El login pide `negocioSlug`: resuelve el NEGOCIO por slug (como el de staff), porque el email
  // no es unico a nivel global.
  const malLogin = await req('POST', '/api/auth/dueno/login', {
    email: 'no-existe@test.invalid', password: 'x'.repeat(12), negocioSlug: SLUG,
  });
  chk('login con credenciales invalidas -> 401', malLogin.status === 401, `status=${malLogin.status}`);
  chk('y NO setea la cookie', !/dueno_token=/.test(malLogin.setCookie), malLogin.setCookie || '(sin Set-Cookie)');

  // 6) LOGIN COMPLETO del dueno demo (sin 2FA) -> cookie con las banderas del repo
  const login = await req('POST', '/api/auth/dueno/login', {
    email: EMAIL_DEMO, password: PASSWORD_DEMO, negocioSlug: SLUG,
  });
  chk('login del dueno demo -> 200/201', [200, 201].includes(login.status), `status=${login.status} ${JSON.stringify(login.data?.message ?? '')}`);
  chk('el body sigue trayendo accessToken (compatibilidad)', typeof login.data?.accessToken === 'string');
  chk('setea la cookie dueno_token', /dueno_token=/.test(login.setCookie), login.setCookie.slice(0, 120));
  chk('la cookie es HttpOnly', /HttpOnly/i.test(login.setCookie));
  const esProd = /^https:/.test(API);
  if (esProd) {
    chk('en prod la cookie es Secure', /Secure/i.test(login.setCookie));
    chk('en prod SameSite=None (cross-subdominio)', /SameSite=None/i.test(login.setCookie));
    chk('en prod Domain=.clubio.lat (la comparten las tres PWAs)', /Domain=\.clubio\.lat/i.test(login.setCookie), login.setCookie.slice(0, 160));
  }

  // 7) y con ESA cookie, /me responde (la cadena completa: login -> cookie -> me)
  const cookieLogin = login.setCookie.split('=').slice(0, 2).join('=');
  if (cookieLogin) {
    const me = await req('GET', '/api/auth/dueno/me', undefined, { Cookie: cookieLogin });
    chk('con la cookie del login -> /me 200', me.status === 200, `status=${me.status}`);
    chk('y /me devuelve el MISMO dueno que el login', me.data?.dueno?.id === dueno.id, String(me.data?.dueno?.id));
  }

  // 8) logout: limpia la cookie
  const out = await req('POST', '/api/auth/dueno/logout', {}, { Cookie: `dueno_token=${token}` });
  chk('POST /auth/dueno/logout -> 200/201', [200, 201].includes(out.status), `status=${out.status}`);
  chk(
    'el logout limpia la cookie (Set-Cookie con expiracion pasada)',
    /dueno_token=;|Expires=Thu, 01 Jan 1970/i.test(out.setCookie),
    out.setCookie.slice(0, 120) || '(sin Set-Cookie)',
  );

  await prisma.$disconnect();
  console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
