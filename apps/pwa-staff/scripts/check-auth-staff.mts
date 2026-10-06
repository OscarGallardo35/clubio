/**
 * Harness de integracion de la sesion de STAFF (PWA Staff) contra el backend real.
 *
 * MODELO DE SESION: cookie HttpOnly `empleado_token`, SIMETRICA a la del cliente
 * (`cliente_token`): mismas banderas, mismo path. El header Bearer queda como
 * fallback para este harness y para llamadas server-to-server (el WebSocket no
 * puede leer cookies desde JS).
 *
 * Las dos vias tienen que funcionar: si la cookie deja de andar, la PWA Staff
 * entera queda afuera, y eso no se nota con un harness que solo use Bearer.
 *
 * El PIN sale del seed (`apps/backend/prisma/seed.ts`):
 *   Maria Encargada -> 1111 (rol ENCARGADO, sucursal Centro)
 *   Juan Cajero     -> 2222
 *   Pedro Mesero    -> 3333
 *
 * Requiere el backend vivo en :3000.
 *
 *   node scripts/check-auth-staff.mts
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SLUG = process.env.TENANT ?? 'bar-la-esquina';
const PIN_MARIA = '1111';

let ok = 0;
const fallas: string[] = [];

function chk(nombre: string, cond: boolean, extra = '') {
  if (cond) ok++;
  else fallas.push(extra ? `${nombre} -> ${extra}` : nombre);
}

async function call(
  path: string,
  init?: RequestInit & { token?: string; cookie?: string },
) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  if (init?.cookie) headers.cookie = init.cookie;
  const res = await fetch(API + path, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* sin body */
  }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') ?? '' };
}

/** Banderas de una cookie, para comparar las dos politicas sin mirar el valor. */
function banderas(setCookie: string) {
  return {
    nombre: setCookie.split('=')[0],
    httpOnly: /HttpOnly/i.test(setCookie),
    path: /Path=\//i.test(setCookie),
    sameSiteLax: /SameSite=Lax/i.test(setCookie),
    secure: /Secure/i.test(setCookie),
    maxAge: /Max-Age=\d+/i.test(setCookie),
  };
}

// 1) Login por PIN: token en el body + cookie HttpOnly
const login = await call('/auth/empleado/login', {
  method: 'POST',
  body: JSON.stringify({ negocioSlug: SLUG, pin: PIN_MARIA }),
});
chk('login por PIN devuelve 201', login.status === 201, `status ${login.status}`);
const token: string | undefined = login.body?.accessToken;
chk('el login entrega accessToken (para el harness y server-to-server)', typeof token === 'string' && token.split('.').length === 3);

const bEmpleado = banderas(login.setCookie);
chk('el login setea la cookie empleado_token', bEmpleado.nombre === 'empleado_token', bEmpleado.nombre || '(sin Set-Cookie)');
chk('la cookie es HttpOnly', bEmpleado.httpOnly);
chk('la cookie tiene Path=/', bEmpleado.path);
chk('la cookie es SameSite=Lax (dev sobre http)', bEmpleado.sameSiteLax);
chk('la cookie NO es Secure en desarrollo', !bEmpleado.secure);
chk('la cookie tiene Max-Age (sesion con vencimiento)', bEmpleado.maxAge);
const cookieEmpleado = login.setCookie.split(';')[0];

if (!token || !cookieEmpleado) {
  console.log(`\n  HAY FALLAS: ${ok} aserciones OK, ${fallas.length} fallas`);
  for (const f of fallas) console.log(`   FALLA ${f}`);
  process.exit(1);
}

// 2) /me por COOKIE (la via de la PWA)
const meCookie = await call('/auth/empleado/me', { cookie: cookieEmpleado });
chk('GET /me con COOKIE -> 200', meCookie.status === 200, `status ${meCookie.status}`);
chk('la cookie identifica al empleado (tipo EMPLEADO)', meCookie.body?.tipo === 'EMPLEADO', `tipo=${meCookie.body?.tipo}`);

// 3) /me por BEARER (fallback)
const meBearer = await call('/auth/empleado/me', { token });
chk('GET /me con BEARER -> 200 (fallback vivo)', meBearer.status === 200, `status ${meBearer.status}`);
chk('las dos vias devuelven lo mismo', JSON.stringify(meCookie.body) === JSON.stringify(meBearer.body));

// 4) Shape del contrato
const me = meBearer;
chk('tipo esta en MAYUSCULAS (vocabulario de las PWAs)', ['DUENO', 'EMPLEADO'].includes(me.body?.tipo));
chk('empleado.nombre sale de la DB', ['Maria Encargada', 'María Encargada'].includes(me.body?.empleado?.nombre), String(me.body?.empleado?.nombre));
chk('empleado.rol es el del seed (ENCARGADO)', me.body?.empleado?.rol === 'ENCARGADO');
chk('la sucursal del empleado es Centro', me.body?.empleado?.sucursal?.slug === 'centro', String(me.body?.empleado?.sucursal?.slug));
chk('sucursal viene tambien en la raiz', me.body?.sucursal?.slug === 'centro');
chk('el negocio trae el branding publico', Boolean(me.body?.negocio?.logoUrl !== undefined && me.body?.negocio?.colorPrimario));
chk('el negocio trae las features del plan', typeof me.body?.negocio?.features === 'object' && me.body?.negocio?.features !== null);
chk('el negocio NO filtra campos de administracion (miNegocio)', me.body?.negocio?.duenoId === undefined);
chk('el shape tiene exactamente las 4 claves del contrato', JSON.stringify(Object.keys(me.body ?? {}).sort()) === JSON.stringify(['empleado', 'negocio', 'sucursal', 'tipo']), JSON.stringify(Object.keys(me.body ?? {})));

// 5) Un endpoint de staff REAL tambien acepta la cookie (no solo /me): el guard
//    es el mismo para toda la PWA, asi que esto es lo que importa de verdad.
const staff = await call('/sucursales/mis-sucursales', { cookie: cookieEmpleado });
chk('un endpoint de staff real acepta la COOKIE (mismo guard)', staff.status === 200, `status ${staff.status}`);

// 6) Sin nada
const sin = await call('/auth/empleado/me');
chk('GET /me sin nada -> 401', sin.status === 401, `status ${sin.status}`);
chk('el 401 explica que falta el token', String(sin.body?.message ?? '').toLowerCase().includes('token'));

// 7) Token basura
const basura = await call('/auth/empleado/me', { token: 'basura.inventada.token' });
chk('GET /me con token basura -> 401', basura.status === 401, `status ${basura.status}`);

// 8) Un token Y una cookie de CLIENTE no sirven aca (el claim `tipo` se valida)
const reg = await call('/auth/cliente/registrar', {
  method: 'POST',
  body: JSON.stringify({ negocioSlug: SLUG, nombre: 'Prueba Staff Harness', telefono: '+5493585799001' }),
});
const cookieCliente = reg.setCookie ? reg.setCookie.split(';')[0] : '';
const tokenCliente: string | undefined = reg.body?.accessToken ?? reg.body?.token;
if (tokenCliente) {
  const cruzado = await call('/auth/empleado/me', { token: tokenCliente });
  chk('un TOKEN de cliente no entra a /auth/empleado/me', cruzado.status === 401, `status ${cruzado.status}`);
} else {
  console.log('  (nota: el registro de cliente no devolvio token en el body; la asercion cruzada por token no se corrio)');
}
if (cookieCliente) {
  const cruzadoCookie = await call('/auth/empleado/me', { cookie: cookieCliente });
  chk('una COOKIE de cliente no entra a /auth/empleado/me', cruzadoCookie.status === 401, `status ${cruzadoCookie.status}`);

  // 9) SIMETRIA: las banderas de las dos cookies tienen que ser las mismas.
  const bCliente = banderas(reg.setCookie);
  const sinNombre = (b: ReturnType<typeof banderas>) => ({ ...b, nombre: '' });
  chk(
    'las banderas de empleado_token son IDENTICAS a las de cliente_token',
    JSON.stringify(sinNombre(bEmpleado)) === JSON.stringify(sinNombre(bCliente)),
    `empleado=${JSON.stringify(sinNombre(bEmpleado))} cliente=${JSON.stringify(sinNombre(bCliente))}`,
  );
}

// 10) Logout limpia la cookie
const out = await call('/auth/empleado/logout', { method: 'POST', cookie: cookieEmpleado });
chk('logout con la cookie -> 201', out.status === 201, `status ${out.status}`);
chk('logout manda el clear de empleado_token', /empleado_token=;/.test(out.setCookie) || /Expires=Thu, 01 Jan 1970/.test(out.setCookie), out.setCookie.slice(0, 80));

// Token vencido: NO se puede forjar desde aca porque JWT_EMPLEADO_SECRET es un
// secreto real (64 chars) en .env, no el fallback de desarrollo. Queda anotado
// como el unico caso del spec sin cubrir, a proposito y no por olvido.
console.log('  (nota: el caso "token vencido" no se cubre: requiere firmar con JWT_EMPLEADO_SECRET real)');

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`);
for (const f of fallas) console.log(`   FALLA ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
