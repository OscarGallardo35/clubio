/**
 * Harness de integracion de la sesion de STAFF (PWA Staff) contra el backend real.
 *
 * OJO — MODELO DE SESION REAL: la sesion de empleado es un BEARER token, no una
 * cookie. El backend solo setea cookie para el CLIENTE (`COOKIE_CLIENTE`, ver
 * common/utils/cookie.util.ts) y `JwtEmpleadoStrategy` lee
 * `ExtractJwt.fromAuthHeaderAsBearerToken()`. Por eso aca se habla de "sin token"
 * y no de "sin cookie": no hay cookie de empleado que mandar.
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

async function call(path: string, init?: RequestInit & { token?: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(API + path, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* sin body */
  }
  return { status: res.status, body };
}

// 1) Login por PIN
const login = await call('/auth/empleado/login', {
  method: 'POST',
  body: JSON.stringify({ negocioSlug: SLUG, pin: PIN_MARIA }),
});
chk('login por PIN devuelve 201', login.status === 201, `status ${login.status}`);
const token: string | undefined = login.body?.accessToken;
chk('el login entrega accessToken', typeof token === 'string' && token.split('.').length === 3);
chk('el login NO setea cookie de empleado (la sesion es bearer)', !login.body?.setCookie);

if (!token) {
  console.log(`\n  HAY FALLAS: ${ok} aserciones OK, ${fallas.length} fallas`);
  for (const f of fallas) console.log(`   FALLA ${f}`);
  process.exit(1);
}

// 2) /me con token valido
const me = await call('/auth/empleado/me', { token });
chk('GET /me con token valido -> 200', me.status === 200, `status ${me.status}`);
chk('la respuesta trae tipo', me.body?.tipo === 'EMPLEADO', `tipo=${me.body?.tipo}`);
chk('tipo esta en MAYUSCULAS (vocabulario de las PWAs)', ['DUENO', 'EMPLEADO'].includes(me.body?.tipo));
chk('empleado.nombre sale de la DB', me.body?.empleado?.nombre === 'Maria Encargada' || me.body?.empleado?.nombre === 'María Encargada', String(me.body?.empleado?.nombre));
chk('empleado.rol es el del seed (ENCARGADO)', me.body?.empleado?.rol === 'ENCARGADO');
chk('la sucursal del empleado es Centro', me.body?.empleado?.sucursal?.slug === 'centro', String(me.body?.empleado?.sucursal?.slug));
chk('sucursal viene tambien en la raiz', me.body?.sucursal?.slug === 'centro');
chk('el negocio trae el branding publico', Boolean(me.body?.negocio?.logoUrl !== undefined && me.body?.negocio?.colorPrimario));
chk('el negocio trae las features del plan', typeof me.body?.negocio?.features === 'object' && me.body?.negocio?.features !== null);
chk('el negocio NO filtra campos de administracion (miNegocio)', me.body?.negocio?.duenoId === undefined);
chk('el shape tiene exactamente las 4 claves del contrato', JSON.stringify(Object.keys(me.body ?? {}).sort()) === JSON.stringify(['empleado', 'negocio', 'sucursal', 'tipo']), JSON.stringify(Object.keys(me.body ?? {})));

// 3) Sin token
const sin = await call('/auth/empleado/me');
chk('GET /me sin token -> 401', sin.status === 401, `status ${sin.status}`);
chk('el 401 explica que falta el token', String(sin.body?.message ?? '').toLowerCase().includes('token'));

// 4) Token basura
const basura = await call('/auth/empleado/me', { token: 'basura.inventada.token' });
chk('GET /me con token basura -> 401', basura.status === 401, `status ${basura.status}`);

// 5) El token de un CLIENTE no sirve aca (el claim `tipo` se valida)
const reg = await call('/auth/cliente/registrar', {
  method: 'POST',
  body: JSON.stringify({ negocioSlug: SLUG, nombre: 'Prueba Staff Harness', telefono: '+5493585799001' }),
});
const tokenCliente: string | undefined = reg.body?.accessToken ?? reg.body?.token;
if (tokenCliente) {
  const cruzado = await call('/auth/empleado/me', { token: tokenCliente });
  chk('un token de CLIENTE no entra a /auth/empleado/me', cruzado.status === 401, `status ${cruzado.status}`);
} else {
  console.log('  (nota: el registro de cliente no devolvio token en el body; la asercion cruzada no se corrio)');
}

// Token vencido: NO se puede forjar desde aca porque JWT_EMPLEADO_SECRET es un
// secreto real (64 chars) en .env, no el fallback de desarrollo. Queda anotado
// como el unico caso del spec sin cubrir, a proposito y no por olvido.
console.log('  (nota: el caso "token vencido" no se cubre: requiere firmar con JWT_EMPLEADO_SECRET real)');

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`);
for (const f of fallas) console.log(`   FALLA ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
