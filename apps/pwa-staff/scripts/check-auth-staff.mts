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

// ---------------------------------------------------------------------------
// 13) El loop completo del QR #2: el cliente pide, el staff valida y resuelve.
//     Es la unica forma de saber que el flujo entero sigue en pie (y de que el
//     link del WhatsApp, /validar?ref=, tenga una pantalla detras).
// ---------------------------------------------------------------------------
// El telefono de cada cliente de prueba tiene que ser UNICO: si se repite, el
// backend devuelve el cliente que ya existe, y si ese cliente ya tiene una visita
// APROBADA hoy, la regla anti-fraude le bloquea la solicitud nueva (eso es
// comportamiento correcto del producto, no un fallo del harness). Con
// `Math.random()` habia colisiones reales entre c1 y c3.
let contadorClientes = 0;

async function clienteNuevo(nombre: string) {
  contadorClientes += 1;
  const telefono = `+5493585${String(contadorClientes).padStart(2, '0')}${String(Date.now()).slice(-5)}`;
  const reg = await call('/auth/cliente/registrar', {
    method: 'POST',
    body: JSON.stringify({ negocioSlug: SLUG, nombre, telefono }),
  });
  return { cookie: reg.setCookie ? reg.setCookie.split(';')[0] : '', status: reg.status, telefono };
}

const c1 = await clienteNuevo('E2E Loop Aprobacion');
chk('se puede registrar un cliente nuevo (201)', c1.status === 201, `status ${c1.status}`);
const sol1 = await call('/visitas/solicitar', {
  method: 'POST', cookie: c1.cookie, body: JSON.stringify({ sucursalSlug: 'centro' }),
});
const token1: string | undefined = sol1.body?.token;
chk('el cliente pide la visita y recibe un token', sol1.status === 201 && typeof token1 === 'string');
chk('el token trae urlValidacion (es el link del WhatsApp)', typeof sol1.body?.urlValidacion === 'string');
chk('urlValidacion apunta a /validar?ref= del STAFF_APP_URL', /\/validar\?ref=/.test(String(sol1.body?.urlValidacion)));

if (token1) {
  const v1 = await call(`/visitas/validar/${token1}`, { cookie: cookieEmpleado });
  chk('el staff valida el token -> 200 y estado VALIDO', v1.status === 200 && v1.body?.estado === 'VALIDO', `status ${v1.status} estado ${v1.body?.estado}`);
  chk('la validacion trae al cliente (con telefono ENMASCARADO)', Boolean(v1.body?.cliente?.nombre) && String(v1.body?.cliente?.telefono).includes('*'));
  chk('la validacion trae la sucursal', v1.body?.sucursal?.slug === 'centro');
  chk('la validacion trae expiraEn (TTL 5 min)', Boolean(v1.body?.expiraEn));

  const a1 = await call(`/visitas/aprobar/${token1}`, { method: 'POST', cookie: cookieEmpleado, body: JSON.stringify({ origen: 'check_auth_staff' }) });
  chk('el staff aprueba -> 2xx con success', a1.status < 300 && a1.body?.success === true, `status ${a1.status}`);
  chk('la aprobacion devuelve sellosActuales y el modo del negocio', typeof a1.body?.sellosActuales === 'number' && ['GLOBAL', 'POR_SUCURSAL'].includes(a1.body?.modoClientes));

  const e1 = await call(`/visitas/estado/${token1}`, { cookie: c1.cookie });
  chk('el CLIENTE ve su visita APROBADA', e1.status === 200 && e1.body?.estado === 'APROBADA', `estado ${e1.body?.estado}`);
  const v1b = await call(`/visitas/validar/${token1}`, { cookie: cookieEmpleado });
  chk('un token ya usado queda como USADO (no se aprueba dos veces)', v1b.body?.estado === 'USADO', `estado ${v1b.body?.estado}`);
}

const c2 = await clienteNuevo('E2E Loop Rechazo');
const sol2 = await call('/visitas/solicitar', { method: 'POST', cookie: c2.cookie, body: JSON.stringify({ sucursalSlug: 'centro' }) });
const token2: string | undefined = sol2.body?.token;
const MOTIVO = 'El telefono ya sumo una visita hoy';
if (token2) {
  const r2 = await call(`/visitas/rechazar/${token2}`, { method: 'POST', cookie: cookieEmpleado, body: JSON.stringify({ motivo: MOTIVO }) });
  chk('el staff rechaza con motivo -> 2xx', r2.status < 300 && r2.body?.success === true, `status ${r2.status}`);
  const e2 = await call(`/visitas/estado/${token2}`, { cookie: c2.cookie });
  chk('el CLIENTE ve RECHAZADA', e2.body?.estado === 'RECHAZADA', `estado ${e2.body?.estado}`);
  chk('el CLIENTE ve EXACTAMENTE el motivo que escribio el staff', e2.body?.motivo === MOTIVO, String(e2.body?.motivo));
}

const inv = await call('/visitas/validar/token-que-no-existe', { cookie: cookieEmpleado });
chk('un token inexistente -> 404 (no 500)', inv.status === 404, `status ${inv.status}`);

// `mis-aprobaciones` NO es la cola de pendientes: devuelve lo que YO aprobe hoy.
const ma = await call('/visitas/mis-aprobaciones', { cookie: cookieEmpleado });
chk('mis-aprobaciones devuelve {data,total,desde} y NO una cola de pendientes', ma.status === 200 && Array.isArray(ma.body?.data) && typeof ma.body?.total === 'number' && ma.body?.desde !== undefined);


// ---------------------------------------------------------------------------
// 14) GET /visitas/pendientes: la cola real del staff.
//     Es la unica forma de saber que la lista no depende del WS ni de un F5.
// ---------------------------------------------------------------------------
const p0 = await call('/visitas/pendientes', { cookie: cookieEmpleado });
chk('GET /visitas/pendientes -> 200 con {data,total}', p0.status === 200 && Array.isArray(p0.body?.data) && typeof p0.body?.total === 'number', `status ${p0.status}`);

const c3 = await clienteNuevo('E2E Pendientes');
const sol3 = await call('/visitas/solicitar', { method: 'POST', cookie: c3.cookie, body: JSON.stringify({ sucursalSlug: 'centro' }) });
const token3: string | undefined = sol3.body?.token;
chk('el cliente pide una visita nueva', sol3.status === 201 && typeof token3 === 'string', `status ${sol3.status} body ${JSON.stringify(sol3.body).slice(0, 90)}`);

if (token3) {
  const p1 = await call('/visitas/pendientes', { cookie: cookieEmpleado });
  const item = (p1.body?.data ?? []).find((x: { token: string }) => x.token === token3);
  chk('la solicitud APARECE en /pendientes', Boolean(item), `total ${p1.body?.total}`);
  if (item) {
    chk('el item trae el cliente con el telefono ENMASCARADO', Boolean(item.cliente?.nombre) && String(item.cliente?.telefonoEnmascarado ?? '').includes('*'));
    chk('el item trae la sucursal y el nombre', item.sucursal?.slug === 'centro' && Boolean(item.sucursal?.nombre));
    chk('el item trae segundosRestantes calculado en el backend (<= 300)', typeof item.segundosRestantes === 'number' && item.segundosRestantes > 0 && item.segundosRestantes <= 300, String(item.segundosRestantes));
  }

  await call(`/visitas/aprobar/${token3}`, { method: 'POST', cookie: cookieEmpleado, body: JSON.stringify({ origen: 'check_auth_staff' }) });
  const p2 = await call('/visitas/pendientes', { cookie: cookieEmpleado });
  chk('tras aprobar, la solicitud DESAPARECE de /pendientes', !(p2.body?.data ?? []).some((x: { token: string }) => x.token === token3));
}

// Alcance por sucursal: Pedro (MESERO, PIN 3333) es de otra sucursal y NO tiene
// accesoMultiSucursal, asi que no debe ver las solicitudes de esta.
const loginPedro = await call('/auth/empleado/login', { method: 'POST', body: JSON.stringify({ negocioSlug: SLUG, pin: '3333' }) });
const cookiePedro = loginPedro.setCookie ? loginPedro.setCookie.split(';')[0] : '';
if (cookiePedro) {
  const mePedro = await call('/auth/empleado/me', { cookie: cookiePedro });
  const suyo = mePedro.body?.sucursal?.slug;
  const multi = mePedro.body?.empleado?.accesoMultiSucursal;
  if (!multi && suyo && suyo !== 'centro') {
    const c4 = await clienteNuevo('E2E Alcance');
    const sol4 = await call('/visitas/solicitar', { method: 'POST', cookie: c4.cookie, body: JSON.stringify({ sucursalSlug: 'centro' }) });
    const tok4: string | undefined = sol4.body?.token;
    const pPedro = await call('/visitas/pendientes', { cookie: cookiePedro });
    chk(
      'un empleado de OTRA sucursal no ve las solicitudes de centro',
      !(pPedro.body?.data ?? []).some((x: { token: string }) => x.token === tok4),
      `pedro=${suyo} multi=${multi} total=${pPedro.body?.total}`,
    );
    if (tok4) await call(`/visitas/rechazar/${tok4}`, { method: 'POST', cookie: cookieEmpleado, body: JSON.stringify({ motivo: 'limpieza del harness' }) });
  } else {
    console.log(`  (nota: el alcance por sucursal no se pudo probar: Pedro es de ${suyo} con multi=${multi})`);
  }
}

// ---------------------------------------------------------------------------
// 15) El socket del staff se autentica SOLO con la cookie (sin auth.token).
//     Es lo que hace que un F5 en /visitas siga recibiendo `visita:solicitada`.
// ---------------------------------------------------------------------------
const { io } = await import('socket.io-client');
const WS_URL = process.env.WS_URL ?? 'http://localhost:3000';
const ws = await new Promise<{ ok: boolean; detalle: string }>((resolve) => {
  const sock = io(`${WS_URL}/visitas`, {
    transports: ['websocket'],
    withCredentials: true,
    reconnection: false,
    extraHeaders: { cookie: cookieEmpleado },
  });
  const listo = setTimeout(() => {
    sock.disconnect();
    resolve({ ok: false, detalle: 'sin respuesta en 10s' });
  }, 10_000);
  sock.on('conectado', (d: { tipo?: string; salas?: string[] }) => {
    clearTimeout(listo);
    sock.disconnect();
    resolve({ ok: true, detalle: `${d?.tipo} en ${(d?.salas ?? []).length} salas` });
  });
  sock.on('connect_error', (e: Error) => {
    clearTimeout(listo);
    sock.disconnect();
    resolve({ ok: false, detalle: e.message });
  });
});
chk('el socket del staff conecta con la COOKIE (sin token en memoria)', ws.ok, ws.detalle);
console.log(`  (socket: ${ws.detalle})`);

console.log('  (nota: el caso "token vencido" no se cubre: requiere firmar con JWT_EMPLEADO_SECRET real)');

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`);
for (const f of fallas) console.log(`   FALLA ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
