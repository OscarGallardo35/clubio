/**
 * Fase 2: PATCH /visitas/:id/monto — corregir el consumo de una visita ya aprobada.
 *
 *   pnpm --filter backend test:editar-monto
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:editar-monto
 *
 * Cubre los 6 casos pedidos:
 *   [1] subir el monto        -> acredita el delta de puntos.
 *   [2] bajarlo con saldo     -> resta el delta.
 *   [3] bajarlo SIN saldo     -> 400 "el cliente ya gasto esos puntos" (no se clampea a 0).
 *   [4] visita inexistente    -> 404.
 *   [5] visita de otro dia    -> 400.
 *   [6] sin permiso           -> 403 (aprobo Maria; corrige Juan, MESERO).
 *
 * Los dos ultimos casos se preparan desde la DB (fecha al dia anterior / saldo en 0): es la unica
 * forma de llegar a esos estados sin esperar un dia o gastar puntos de verdad.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const PIN = process.env.STAFF_PIN || '1111';
const prisma = new PrismaClient();

let ok = 0, falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 170) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

async function req(method, path, { body, token, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  const crudas = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, data, setCookie: [...crudas, res.headers.get('set-cookie') ?? ''].join(' | ') };
}
const cookieDe = (s) => String(s).split('|').map((c) => c.trim().split(';')[0]).filter((c) => c.startsWith('cliente_token=')).join('; ');
const b64 = (b) => Buffer.from(b).toString('base64url');
function firmar(payload, secret) {
  const c = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}`;
  return `${c}.${b64(createHmac('sha256', secret).update(c).digest())}`;
}
function buscarItem(obj, acc = []) {
  if (obj && typeof obj === 'object') {
    if (obj.nombre && (obj.id || obj.itemId)) acc.push({ id: obj.id || obj.itemId, nombre: obj.nombre });
    for (const v of Object.values(obj)) buscarItem(v, acc);
  }
  return acc;
}

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);
  const tel = `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
  let clienteId = null, visitaId = null, sucursalId = null;

  const limpiar = async () => {
    try {
      if (clienteId) {
        await prisma.visita.deleteMany({ where: { clienteId } });
        await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } });
        await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
        await prisma.pedido.deleteMany({ where: { clienteId } });
        await prisma.cliente.deleteMany({ where: { id: clienteId } });
      }
      await prisma.cliente.deleteMany({ where: { telefono: tel } });
    } catch (e) { console.log('  (cleanup parcial: ' + e.message.split('\n')[0] + ')'); }
  };

  try {
    const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true, modoClientes: true } });
    if (!negocio) { console.log('No encontre el negocio ' + SLUG); process.exit(2); }
    const cfg = await prisma.configuracionClub.findUnique({ where: { negocioId: negocio.id }, select: { puntosPorMil: true, modoFidelizacion: true } });
    const tasa = cfg?.puntosPorMil ?? 5;
    const porSucursal = negocio.modoClientes === 'POR_SUCURSAL';
    const calcular = (monto) => Math.floor((monto / 1000) * tasa);
    console.log(`config: modo=${cfg?.modoFidelizacion} tasa=${tasa} modoClientes=${negocio.modoClientes}`);
    console.log(`puntos esperados: 10000 -> ${calcular(10000)} | 5000 -> ${calcular(5000)} | 1000 -> ${calcular(1000)}\n`);

    const staff = await req('POST', '/api/auth/empleado/login', { body: { negocioSlug: SLUG, pin: PIN } });
    const staffToken = staff.data?.accessToken;
    const aprobadorId = staff.data?.empleado?.id ?? null;
    if (!staffToken) { console.log('SIN TOKEN DE STAFF: ' + trunc(staff.data)); process.exit(2); }
    const carta = await req('GET', '/api/carta?sucursalSlug=centro');
    const item = buscarItem(carta.data)[0];
    if (!item) { console.log('No encontre un item de carta'); process.exit(2); }

    // ---------------------------------------------------------------- setup
    console.log('[setup] cliente + visita aprobada SIN monto');
    const reg = await req('POST', '/api/auth/cliente/registrar', {
      body: { nombre: 'Harness Monto', telefono: tel, negocioSlug: SLUG },
    });
    const cookie = cookieDe(reg.setCookie);
    clienteId = (await prisma.cliente.findFirst({ where: { telefono: tel }, select: { id: true } }))?.id ?? null;
    chk('cliente creado', reg.status >= 200 && reg.status < 300 && !!clienteId, `status=${reg.status}`);
    const sol = await req('POST', '/api/visitas/solicitar', { cookie, body: {} });
    const tokenVisita = sol.data?.token;
    chk('visita solicitada', sol.status >= 200 && sol.status < 300 && !!tokenVisita, `status=${sol.status}`);
    const ap = await req('POST', `/api/visitas/aprobar/${tokenVisita}`, { token: staffToken, body: {} });
    chk('aprobada SIN monto -> 2xx', ap.status >= 200 && ap.status < 300, `status=${ap.status} ${trunc(ap.data, 120)}`);
    let visita = await prisma.visita.findFirst({
      where: { clienteId }, orderBy: { aprobadoEn: 'desc' },
      select: { id: true, montoConsumido: true, puntosOtorgados: true, sucursalId: true, empleadoId: true },
    });
    visitaId = visita?.id ?? null;
    sucursalId = visita?.sucursalId ?? null;
    chk('la visita quedo SIN monto y con 0 puntos', visita?.montoConsumido === null && visita?.puntosOtorgados === 0,
      `monto=${visita?.montoConsumido} puntos=${visita?.puntosOtorgados}`);
    const saldo = async () => porSucursal
      ? (await prisma.tarjetaClienteSucursal.findFirst({ where: { clienteId, sucursalId }, select: { puntosActuales: true } }))?.puntosActuales
      : (await prisma.cliente.findUnique({ where: { id: clienteId }, select: { puntosActuales: true } }))?.puntosActuales;
    console.log(`saldo inicial: ${await saldo()}\n`);

    const patch = (id, monto, token = staffToken) => req('PATCH', `/api/visitas/${id}/monto`, { token, body: { montoConsumido: monto } });

    // ------------------------------------------------------- [1] subir el monto
    console.log('[1] subir el monto a 10000');
    let r = await patch(visitaId, 10000);
    chk('PATCH -> 2xx', r.status >= 200 && r.status < 300, `status=${r.status} ${trunc(r.data)}`);
    visita = await prisma.visita.findUnique({ where: { id: visitaId }, select: { montoConsumido: true, puntosOtorgados: true } });
    chk('la visita quedo con el monto nuevo', Number(visita?.montoConsumido) === 10000, `monto=${Number(visita?.montoConsumido)}`);
    chk('los puntos se recalcularon', visita?.puntosOtorgados === calcular(10000), `puntos=${visita?.puntosOtorgados} esperado=${calcular(10000)}`);
    chk('el saldo del cliente subio ese delta', (await saldo()) === calcular(10000), `saldo=${await saldo()}`);

    // ------------------------------------------------------ [2] bajarlo con saldo
    console.log('\n[2] bajar el monto a 5000 (con saldo)');
    r = await patch(visitaId, 5000);
    chk('PATCH -> 2xx', r.status >= 200 && r.status < 300, `status=${r.status}`);
    visita = await prisma.visita.findUnique({ where: { id: visitaId }, select: { montoConsumido: true, puntosOtorgados: true } });
    chk('monto y puntos bajaron', Number(visita?.montoConsumido) === 5000 && visita?.puntosOtorgados === calcular(5000),
      `monto=${Number(visita?.montoConsumido)} puntos=${visita?.puntosOtorgados}`);
    chk('el saldo quedo en el valor nuevo', (await saldo()) === calcular(5000), `saldo=${await saldo()}`);

    // -------------------------------------------------- [3] bajarlo sin saldo
    console.log('\n[3] bajar el monto SIN saldo (el cliente ya los gasto)');
    if (porSucursal) await prisma.tarjetaClienteSucursal.updateMany({ where: { clienteId, sucursalId }, data: { puntosActuales: 0 } });
    else await prisma.cliente.update({ where: { id: clienteId }, data: { puntosActuales: 0 } });
    r = await patch(visitaId, 1000);
    chk('PATCH -> 400 (no 2xx)', r.status === 400, `status=${r.status}`);
    chk('el mensaje explica que ya se gastaron', /ya gasto esos puntos/i.test(String(r.data?.message ?? '')), trunc(r.data?.message, 140));
    const trasRechazo = await prisma.visita.findUnique({ where: { id: visitaId }, select: { montoConsumido: true, puntosOtorgados: true } });
    chk('la visita NO cambio (rechazo atomico)', Number(trasRechazo?.montoConsumido) === 5000 && trasRechazo?.puntosOtorgados === calcular(5000),
      `monto=${Number(trasRechazo?.montoConsumido)} puntos=${trasRechazo?.puntosOtorgados}`);

    // ------------------------------------------------------- [6] sin permiso
    console.log('\n[6] sin permiso: corrige otro empleado (MESERO) -> 403, el dueño -> 2xx');
    const otro = await prisma.empleado.findFirst({
      where: { negocioId: negocio.id, rol: 'MESERO', activo: true, eliminadoEn: null, id: { not: visita?.empleadoId ?? '' } },
      select: { id: true, sucursalId: true, nombre: true },
    });
    if (otro && process.env.JWT_EMPLEADO_SECRET) {
      const tokOtro = firmar({
        sub: otro.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'MESERO',
        sucursalId: otro.sucursalId, tipo: 'empleado', jti: randomUUID(), iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      }, process.env.JWT_EMPLEADO_SECRET);
      const rOtro = await patch(visitaId, 5000, tokOtro);
      chk(`PATCH con ${otro.nombre} (MESERO, no aprobo) -> 403`, rOtro.status === 403, `status=${rOtro.status} ${trunc(rOtro.data, 90)}`);
    } else {
      chk('habia un MESERO y JWT_EMPLEADO_SECRET para probar el 403', false, otro ? 'falta el secret' : 'no hay MESERO');
    }
    if (process.env.JWT_DUENO_SECRET && process.env.JWT_DUENO_SECRET !== 'x') {
      const dueno = await prisma.empleado.findFirst({ where: { negocioId: negocio.id, rol: 'DUENO', activo: true }, select: { id: true, sucursalId: true } });
      const tokD = firmar({
        sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'DUENO',
        sucursalId: dueno.sucursalId, tipo: 'dueno', jti: randomUUID(), iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      }, process.env.JWT_DUENO_SECRET);
      const rD = await patch(visitaId, 5000, tokD);
      chk('control positivo: el DUENO puede corregir la de otro -> 2xx', rD.status >= 200 && rD.status < 300, `status=${rD.status} ${trunc(rD.data, 90)}`);
    } else {
      chk('estaba JWT_DUENO_SECRET para el control positivo', false, 'falta el secret');
    }

    // ------------------------------------------------------- [4] inexistente
    console.log('\n[4] visita inexistente -> 404');
    r = await patch('no-existe-esta-visita', 5000);
    chk('PATCH de una visita inexistente -> 404', r.status === 404, `status=${r.status} ${trunc(r.data, 90)}`);

    // --------------------------------------------------------- [5] otro dia
    console.log('\n[5] visita de otro dia -> 400 (ultimo porque ensucia la fecha)');
    await prisma.visita.update({ where: { id: visitaId }, data: { aprobadoEn: new Date(Date.now() - 30 * 3600 * 1000) } });
    r = await patch(visitaId, 5000);
    chk('PATCH de una visita de ayer -> 400', r.status === 400, `status=${r.status}`);
    chk('el mensaje habla del mismo dia', /mismo dia/i.test(String(r.data?.message ?? '')), trunc(r.data?.message, 130));
  } catch (e) {
    falla++;
    console.log('\nEXCEPCION: ' + (e && e.message ? e.message.split('\n')[0] : e));
  } finally {
    await limpiar();
    await prisma.$disconnect();
    console.log('\ncleanup: cliente, visitas y tokens de la corrida borrados');
    console.log(`TOTAL: ${ok} OK, ${falla} FALLA`);
    console.log(falla === 0 ? 'TOTAL OK' : 'TOTAL FALLA');
    process.exit(falla === 0 ? 0 : 1);
  }
})();
