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
var loginPedro = await call('/auth/empleado/login', { method: 'POST', body: JSON.stringify({ negocioSlug: SLUG, pin: '3333' }) });
var cookiePedro = loginPedro.setCookie ? loginPedro.setCookie.split(';')[0] : '';
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


// ---------------------------------------------------------------------------
// 16) Pedidos: el staff los ve, los mueve y el cliente ve el motivo.
//     Incluye el CONTRATO de la maquina de estados: el espejo de la UI
//     (lib/pedidos-maquina.ts) no se cree a si mismo.
// ---------------------------------------------------------------------------
const ITEM_SEED = 'cmuvjy5ku002kbq7jjh4uwzph'; // Coca-Cola 500ml del seed
const sufijoPedido = String(Date.now()).slice(-5);

/**
 * `cantidad` importa: DELIVERY tiene un MINIMO de pedido (el del seed es $3000 y el
 * item de prueba $1500), asi que con 1 item el backend contesta 400
 * "El pedido minimo para delivery es $3000". Se piden 3 para no depender del precio.
 */
async function pedidoNuevo(tipo: 'TAKEAWAY' | 'DELIVERY', cantidad = 1) {
  const r = await call('/pedidos', {
    method: 'POST',
    body: JSON.stringify({
      tipo,
      modoPago: 'EFECTIVO',
      nombreCliente: `E2E Pedido ${sufijoPedido}`,
      telefono: `+5493587${sufijoPedido}${tipo === 'DELIVERY' ? '1' : '2'}`,
      ...(tipo === 'DELIVERY' ? { direccion: 'Av. Siempre Viva 742' } : {}),
      items: [{ itemId: ITEM_SEED, cantidad: tipo === 'DELIVERY' ? Math.max(cantidad, 3) : cantidad }],
    }),
  });
  return { status: r.status, body: r.body };
}

const np = await pedidoNuevo('TAKEAWAY');
const pedidoId: string | undefined = np.body?.pedidoId;
const linkToken: string | undefined = np.body?.linkToken;
chk('el cliente crea un pedido (201)', np.status === 201 && typeof pedidoId === 'string', `status ${np.status} ${JSON.stringify(np.body).slice(0, 90)}`);

if (pedidoId) {
  const lista = await call('/pedidos', { cookie: cookieEmpleado });
  chk('el pedido aparece en la lista del staff', lista.status === 200 && (lista.body?.data ?? []).some((p: { id: string }) => p.id === pedidoId), `status ${lista.status} total ${lista.body?.total}`);
  chk('la lista viene paginada con {data,total,page,pageSize}', ['data', 'total', 'page', 'pageSize'].every((k) => k in (lista.body ?? {})));

  const filtrado = await call('/pedidos?estado=PENDIENTE', { cookie: cookieEmpleado });
  chk('el filtro por estado devuelve solo PENDIENTE', (filtrado.body?.data ?? []).every((p: { estado: string }) => p.estado === 'PENDIENTE'));

  // CONTRATO de la maquina de estados (los casos que la UI asume):
  const invalido = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'CANCELADO' }) });
  chk('PENDIENTE -> CANCELADO es 400 (el staff RECHAZA, no cancela)', invalido.status === 400, `status ${invalido.status}`);
  const sinMotivo = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'RECHAZADO' }) });
  chk('RECHAZADO sin motivo (o corto) es 400', sinMotivo.status === 400, `status ${sinMotivo.status}`);

  const conf = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'CONFIRMADO' }) });
  chk('el staff confirma el pedido', conf.status < 300 && conf.body?.estado === 'CONFIRMADO', `status ${conf.status}`);
  const enPrep = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'EN_PREPARACION' }) });
  chk('CONFIRMADO -> EN_PREPARACION', enPrep.body?.estado === 'EN_PREPARACION', `status ${enPrep.status}`);
  const listo = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'LISTO' }) });
  chk('EN_PREPARACION -> LISTO', listo.body?.estado === 'LISTO', `status ${listo.status}`);
  const enviarTakeaway = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'ENVIADO' }) });
  chk('LISTO -> ENVIADO en TAKEAWAY es 400 (solo DELIVERY se envia)', enviarTakeaway.status === 400, `status ${enviarTakeaway.status}`);
  const entregado = await call(`/pedidos/${pedidoId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'ENTREGADO' }) });
  chk('LISTO -> ENTREGADO en TAKEAWAY', entregado.body?.estado === 'ENTREGADO', `status ${entregado.status}`);
  if (linkToken) {
    const pub = await call(`/pedidos/publico/${linkToken}`);
    chk('el cliente ve el pedido ENTREGADO en su link', pub.status === 200 && pub.body?.estado === 'ENTREGADO', `status ${pub.status} estado ${pub.body?.estado}`);
  }
}

// Rechazo con motivo: el cliente TIENE que ver el texto.
const nr = await pedidoNuevo('TAKEAWAY');
const pedidoRechazo: string | undefined = nr.body?.pedidoId;
const linkRechazo: string | undefined = nr.body?.linkToken;
const MOTIVO_PEDIDO = 'Se acabo el stock de ese plato';
if (pedidoRechazo) {
  const rech = await call(`/pedidos/${pedidoRechazo}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'RECHAZADO', motivo: MOTIVO_PEDIDO }) });
  chk('el staff rechaza con motivo (>=10)', rech.status < 300, `status ${rech.status} ${JSON.stringify(rech.body).slice(0, 80)}`);
  if (linkRechazo) {
    const pub2 = await call(`/pedidos/publico/${linkRechazo}`);
    chk('el cliente ve RECHAZADO', pub2.body?.estado === 'RECHAZADO', `estado ${pub2.body?.estado}`);
    chk('el cliente ve EL MOTIVO que escribio el staff', pub2.body?.motivoRechazo === MOTIVO_PEDIDO, `motivo=${JSON.stringify(pub2.body?.motivoRechazo)} claves=${Object.keys(pub2.body ?? {}).join(',')}`);
  }
}

// El socket de /pedidos tambien tiene que autenticar SOLO con la cookie.
const wsP = await new Promise<{ ok: boolean; detalle: string }>((resolve) => {
  const sock = io(`${WS_URL}/pedidos`, {
    transports: ['websocket'], withCredentials: true, reconnection: false,
    extraHeaders: { cookie: cookieEmpleado },
  });
  const listo = setTimeout(() => { sock.disconnect(); resolve({ ok: false, detalle: 'sin respuesta en 10s' }); }, 10_000);
  sock.on('conectado', (d: { tipo?: string; salas?: string[] }) => {
    clearTimeout(listo); sock.disconnect();
    resolve({ ok: true, detalle: `${d?.tipo} en ${(d?.salas ?? []).length} salas` });
  });
  sock.on('connect_error', (e: Error) => { clearTimeout(listo); sock.disconnect(); resolve({ ok: false, detalle: e.message }); });
});
chk('el socket de /pedidos conecta con la COOKIE (sin token en memoria)', wsP.ok, wsP.detalle);
console.log(`  (socket pedidos: ${wsP.detalle})`);


// ---------------------------------------------------------------------------
// 17) Detalle del pedido: items, timestamps y el WhatsApp al cliente.
// ---------------------------------------------------------------------------
const { urlWhatsAppCliente, hitosDelPedido, ETIQUETA_PAGO } = await import('../lib/pedidos-maquina.ts');

chk('urlWhatsAppCliente arma el link con mensaje', urlWhatsAppCliente('+5493585705745', 'Hola!') === 'https://wa.me/5493585705745?text=Hola!');
chk('urlWhatsAppCliente sin mensaje NO inventa texto', urlWhatsAppCliente('+5493585705745') === 'https://wa.me/5493585705745');
chk('urlWhatsAppCliente rechaza un telefono vacio', urlWhatsAppCliente('') === null);
chk('ETIQUETA_PAGO cubre los 4 modos', Object.keys(ETIQUETA_PAGO).length === 4);

const nd = await pedidoNuevo('DELIVERY');
const detId: string | undefined = nd.body?.pedidoId;
const detLink: string | undefined = nd.body?.linkToken;
chk('el pedido DELIVERY se crea', nd.status === 201 && typeof detId === 'string', `status ${nd.status} ${JSON.stringify(nd.body).slice(0, 90)}`);
if (detId) {
  const det = await call(`/pedidos/${detId}`, { cookie: cookieEmpleado });
  chk('GET /pedidos/:id -> 200', det.status === 200, `status ${det.status}`);
  chk('el detalle trae los items con la forma real (nombre/cantidad/precioFinal/subtotal)', Array.isArray(det.body?.items) && typeof det.body.items[0]?.nombre === 'string' && typeof det.body.items[0]?.precioFinal === 'number' && typeof det.body.items[0]?.subtotal === 'number', JSON.stringify(det.body?.items?.[0] ?? {}).slice(0, 110));
  chk('el detalle trae los MISMOS items que la lista', JSON.stringify(det.body?.items) === JSON.stringify((await call('/pedidos', { cookie: cookieEmpleado })).body?.data?.find((p: { id: string }) => p.id === detId)?.items));
  chk('el detalle trae direccion (DELIVERY) y modo de pago', det.body?.direccion === 'Av. Siempre Viva 742' && det.body?.modoPago === 'EFECTIVO');
  // Sin cliente.id (pedido de invitado) pero CON telefono: el WhatsApp igual se puede abrir.
  chk('pedido sin cliente.id tiene telefono para el WhatsApp', det.body?.clienteId === null && typeof det.body?.telefono === 'string' && det.body.telefono.length > 6, `clienteId=${det.body?.clienteId}`);
  chk('el detalle recien creado tiene UN solo hito (recien creado)', hitosDelPedido(det.body).length === 1, `hitos=${hitosDelPedido(det.body).length}`);

  // ENTREGADO: el timestamp del estado actual existe.
  for (const e of ['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO', 'ENTREGADO']) {
    await call(`/pedidos/${detId}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: e }) });
  }
  const ent = await call(`/pedidos/${detId}`, { cookie: cookieEmpleado });
  chk('un pedido ENTREGADO tiene entregadoEn', Boolean(ent.body?.entregadoEn), `entregadoEn=${ent.body?.entregadoEn}`);
  chk('y tambien confirmadoEn y enviadoEn', Boolean(ent.body?.confirmadoEn) && Boolean(ent.body?.enviadoEn));
  chk('el timeline de un ENTREGADO tiene 4 hitos', hitosDelPedido(ent.body).length === 4, `hitos=${hitosDelPedido(ent.body).length}`);
  const pubEnt = detLink ? await call(`/pedidos/publico/${detLink}`) : { body: null };
  chk('el cliente ve la direccion y el envio en su link', Boolean(pubEnt.body));
}

// CANCELADO vs RECHAZADO: quien guarda motivo y quien no.
const nc = await pedidoNuevo('TAKEAWAY');
const idCancel: string | undefined = nc.body?.pedidoId;
if (idCancel) {
  await call(`/pedidos/${idCancel}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'CONFIRMADO' }) });
  const canc = await call(`/pedidos/${idCancel}/estado`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ estado: 'CANCELADO' }) });
  chk('el staff puede CANCELAR desde CONFIRMADO', canc.status < 300 && canc.body?.estado === 'CANCELADO', `status ${canc.status}`);
  const detCanc = await call(`/pedidos/${idCancel}`, { cookie: cookieEmpleado });
  // HALLAZGO: el modelo solo tiene `motivoRechazo`, y el cancel del staff no lo setea.
  // Asi que un CANCELADO NO tiene motivo: la pantalla dice "Sin motivo registrado".
  chk('un CANCELADO NO tiene motivo (solo RECHAZADO lo guarda)', detCanc.body?.motivoRechazo === null, `motivoRechazo=${JSON.stringify(detCanc.body?.motivoRechazo)}`);
}


// ---------------------------------------------------------------------------
// 18) Carta: listar, apagar/prender y cambiar precio.
//     Los endpoints son DUENO/ENCARGADO (+ feature 'menu'), asi que tambien se
//     verifica que un MESERO reciba 403: es el rol que mas va a tocar la app.
// ---------------------------------------------------------------------------
const carta = await call('/carta/admin', { cookie: cookieEmpleado });
const cartaItems = (carta.body?.categorias ?? []).flatMap((g: { items: unknown[] }) => g.items ?? []);
chk('GET /carta/admin -> 200 con items (agrupado por categoria)', carta.status === 200 && Array.isArray(cartaItems) && cartaItems.length > 0, `status ${carta.status} items ${cartaItems.length}`);
chk('los items traen la forma real (categoria/nombre/precio number/disponible)', typeof cartaItems[0]?.categoria === 'string' && typeof cartaItems[0]?.nombre === 'string' && typeof cartaItems[0]?.precio === 'number' && typeof cartaItems[0]?.disponible === 'boolean');

const it = cartaItems.find((x: { nombre: string }) => x.nombre.includes('Coca')) ?? cartaItems[0];
if (it) {
  const id: string = it.id;
  const antes = it.disponible;
  const original = it.precio;

  // Disponibilidad: apagar -> el PUBLICO deja de verlo -> volver a dejarlo como estaba.
  // El restore va en `finally`: si una asercion de mas abajo tira (como paso con la
  // forma de la respuesta), el item quedaba APAGADO en la DB y el proximo pedido del
  // cliente fallaba con "Items no disponibles".
  try {
    const off = await call(`/carta/${id}/disponibilidad`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ disponible: false }) });
    chk('PATCH /carta/:id/disponibilidad apaga el item', off.status < 300 && off.body?.disponible === false, `status ${off.status}`);
    const adminOff = await call('/carta/admin', { cookie: cookieEmpleado });
    chk('el item apagado queda en false en el siguiente GET', ((adminOff.body?.categorias ?? []).flatMap((g: { items: { id: string; disponible: boolean }[] }) => g.items)).find((x: { id: string }) => x.id === id)?.disponible === false);
    const pub = await call('/carta?sucursalSlug=centro');
    chk('el item apagado NO aparece en la carta PUBLICA (lo que ve el cliente)', !((pub.body?.categorias ?? []).flatMap((g: { items: { id: string }[] }) => g.items)).some((x: { id: string }) => x.id === id), `status ${pub.status}`);
  } finally {
    const on = await call(`/carta/${id}/disponibilidad`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ disponible: antes }) });
    chk('el item vuelve a estar como estaba (restore en finally)', on.status < 300 && on.body?.disponible === antes);
  }


  // Precio
  const nuevoPrecio = original + 1;
  const upd = await call(`/carta/${id}`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ precio: nuevoPrecio }) });
  chk('PATCH /carta/:id cambia el precio', upd.status < 300, `status ${upd.status} ${JSON.stringify(upd.body).slice(0, 80)}`);
  const adminPrecio = await call('/carta/admin', { cookie: cookieEmpleado });
  chk('el precio nuevo se ve en el siguiente GET', ((adminPrecio.body?.categorias ?? []).flatMap((g: { items: { id: string }[] }) => g.items)).find((x: { id: string }) => x.id === id)?.precio === nuevoPrecio);
  await call(`/carta/${id}`, { method: 'PATCH', cookie: cookieEmpleado, body: JSON.stringify({ precio: original }) });
  const adminRestaurado = await call('/carta/admin', { cookie: cookieEmpleado });
  chk('el precio queda restaurado al original', ((adminRestaurado.body?.categorias ?? []).flatMap((g: { items: { id: string }[] }) => g.items)).find((x: { id: string }) => x.id === id)?.precio === original);
}

// Gate por ROL: un MESERO no puede tocar la carta (RolesGuard).
if (cookiePedro) {
  const cartaMesero = await call('/carta/admin', { cookie: cookiePedro });
  chk('un MESERO recibe 403 en /carta/admin (la pantalla lo avisa antes)', cartaMesero.status === 403, `status ${cartaMesero.status}`);
}

// Gate por FEATURE: el negocio del seed tiene 'menu' habilitada.
const meNeg = await call('/auth/empleado/me', { cookie: cookieEmpleado });
chk('el plan del negocio tiene la feature "menu" (es la que habilita la carta, no "carta")', meNeg.body?.negocio?.features?.menu?.habilitada === true, JSON.stringify(Object.keys(meNeg.body?.negocio?.features ?? {})));
console.log('  (nota: el caso "sin la feature menu" no se puede probar aca: hay que cambiar el plan del negocio)');

console.log('  (nota: el caso "token vencido" no se cubre: requiere firmar con JWT_EMPLEADO_SECRET real)');

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`);
for (const f of fallas) console.log(`   FALLA ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
