/**
 * Verifica por WebSocket que un CLIENTE logueado recibe el CANCEL de su pedido
 * EN VIVO (sin esperar el polling de 5 s). Cubre los dos caminos del cancel:
 *
 *   A) el STAFF cancela:  PATCH /pedidos/:id/estado { estado:'CANCELADO' }
 *      -> backend: cambiarEstado -> emitirEstado -> `pedido:estado-actualizado`
 *   B) el CLIENTE cancela por el link: POST /pedidos/publico/:linkToken/cancelar
 *      -> backend: cancelarYNotificar -> emitirCancelado -> `pedido:cancelado`
 *
 * El socket del cliente se abre SIN `auth.pedidoId`, asi que SOLO esta en la
 * sala `cliente:{id}`: es la prueba directa de que esa sala entrega (el bug
 * historico era que `emitirEstado` descartaba esa sala al no reasignar `.to()`,
 * y que `emitirCancelado` ni siquiera la incluia).
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:ws-cancelado
 *
 * Firma los JWT a mano (HS256) con los secretos del entorno y usa ids reales del
 * tenant via prisma. Deja los pedidos de prueba borrados.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { io } = require(require.resolve('socket.io-client', {
  paths: [require('path').join(__dirname, '../../pwa-cliente')],
}));

const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';

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

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

function buscarItem(obj, acc) {
  if (obj && typeof obj === 'object') {
    if (obj.nombre && (obj.id || obj.itemId)) acc.push({ id: obj.id || obj.itemId, nombre: obj.nombre });
    for (const v of Object.values(obj)) buscarItem(v, acc);
  }
  return acc;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const SEC_CLI = process.env.JWT_CLIENTE_SECRET;
  const SEC_EMP = process.env.JWT_EMPLEADO_SECRET;
  if (!SEC_CLI || !SEC_EMP) { console.log('FALTAN JWT_CLIENTE_SECRET / JWT_EMPLEADO_SECRET en el entorno.'); process.exit(2); }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!negocio) { console.log('No encontre el negocio.'); process.exit(2); }

  const cliente = process.env.HARNESS_CLIENTE_ID
    ? { id: process.env.HARNESS_CLIENTE_ID }
    : await prisma.cliente.findFirst({ where: { negocioId: negocio.id, eliminadoEn: null }, select: { id: true }, orderBy: { creadoEn: 'desc' } });
  const encargado = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, activo: true, eliminadoEn: null, rol: 'ENCARGADO' },
    select: { id: true, sucursalId: true, nombre: true },
  });
  if (!cliente || !encargado) { console.log('Faltan cliente o encargado para el tenant.'); process.exit(2); }
  console.log(`cliente:   ${cliente.id}`);
  console.log(`encargado: ${encargado.nombre} (${encargado.id}) sucursal=${encargado.sucursalId}\n`);

  const tokenCliente = firmar(
    { sub: cliente.id, negocioId: negocio.id, negocioSlug: SLUG, tipo: 'cliente', jti: randomUUID() },
    SEC_CLI,
  );
  const tokenStaff = firmar(
    { sub: encargado.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'ENCARGADO',
      sucursalId: encargado.sucursalId, tipo: 'empleado', jti: randomUUID() },
    SEC_EMP,
  );

  // ---- Socket del CLIENTE: SIN pedidoId, SOLO la sala cliente:{id} ----
  const socket = io(`${API}/pedidos`, { transports: ['websocket'], auth: { token: tokenCliente }, reconnection: false });
  const recibidos = [];
  socket.on('pedido:cancelado', (p) => recibidos.push({ evento: 'pedido:cancelado', t: Date.now(), p }));
  socket.on('pedido:estado-actualizado', (p) => recibidos.push({ evento: 'pedido:estado-actualizado', t: Date.now(), p }));
  const conectado = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(null), 8000);
    socket.on('conectado', (d) => { clearTimeout(to); resolve(d); });
    socket.on('connect_error', (e) => { clearTimeout(to); resolve({ error: e.message }); });
    socket.on('error', (e) => { clearTimeout(to); resolve({ error: e?.message ?? e }); });
  });
  console.log(`conectado: ${JSON.stringify(conectado)}`);
  const salas = conectado?.salas ?? [];
  chk('el socket del cliente esta en su sala cliente:{id}', salas.includes(`cliente:${cliente.id}`), JSON.stringify(salas));
  chk('el socket NO esta en pedido:{id} (asi se prueba la sala del cliente a secas)', !salas.some((s) => s.startsWith('pedido:')));

  const carta = await req('GET', '/api/carta?sucursalSlug=centro');
  const coca = buscarItem(carta.data, []).find((i) => /coca/i.test(i.nombre));
  if (!coca) { console.log('No encontre un item de la carta.'); socket.close(); await prisma.$disconnect(); process.exit(2); }

  const crear = (nombre) => req('POST', '/api/pedidos', {
    tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', nombreCliente: nombre,
    telefono: `+54911${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900) + 100}`,
    items: [{ itemId: coca.id, cantidad: 1 }],
  }, tokenCliente);
  const borrar = async (ids) => { if (ids.length) { const r = await prisma.pedido.deleteMany({ where: { id: { in: ids } } }); console.log(`cleanup: ${r.count} pedido(s) borrados`); } };

  const ids = [];
  try {
    // ================= A) el STAFF cancela (emitirEstado) =================
    console.log('\n[A] el STAFF cancela el pedido');
    const a = await crear('Harness WS A');
    chk('pedido A creado (201)', a.status === 201, `status=${a.status}`);
    if (a.data?.pedidoId) {
      ids.push(a.data.pedidoId);
      const dbA = await prisma.pedido.findUnique({ where: { id: a.data.pedidoId }, select: { clienteId: true } });
      chk('A quedo ligado al cliente', dbA?.clienteId === cliente.id, JSON.stringify(dbA));

      await esperar(400);
      const t0 = Date.now();
      const conf = await req('PATCH', `/api/pedidos/${a.data.pedidoId}/estado`, { estado: 'CONFIRMADO' }, tokenStaff);
      const canc = await req('PATCH', `/api/pedidos/${a.data.pedidoId}/estado`, { estado: 'CANCELADO' }, tokenStaff);
      chk('staff: PENDIENTE -> CONFIRMADO -> CANCELADO (200)',
        conf.status === 200 && canc.status === 200, `conf=${conf.status} canc=${canc.status} ${JSON.stringify(canc.data?.message ?? '')}`);
      await esperar(2000);
      const ev = recibidos.filter((r) => r.p?.pedidoId === a.data.pedidoId
        && ((r.evento === 'pedido:estado-actualizado' && r.p?.estado === 'CANCELADO') || r.evento === 'pedido:cancelado'));
      for (const r of ev) console.log(`    +${r.t - t0} ms  ${r.evento}  ${JSON.stringify(r.p)}`);
      chk('el cliente vio el CANCELADO del staff en vivo (< 10 s)', ev.length > 0 && (ev[0].t - t0) < 10_000,
        ev.length ? `+${ev[0].t - t0}ms ${ev[0].evento}` : 'NADA');
    }

    // ============ B) el CLIENTE cancela por link (emitirCancelado) =========
    console.log('\n[B] el CLIENTE cancela por linkToken (evento pedido:cancelado)');
    const b = await crear('Harness WS B');
    chk('pedido B creado (201)', b.status === 201, `status=${b.status}`);
    if (b.data?.pedidoId) {
      ids.push(b.data.pedidoId);
      recibidos.length = 0;
      await esperar(400);
      const t0 = Date.now();
      const cb = await req('POST', `/api/pedidos/publico/${b.data.linkToken}/cancelar`);
      chk('POST publico/:linkToken/cancelar -> 200/201', [200, 201].includes(cb.status), `status=${cb.status} ${JSON.stringify(cb.data?.message ?? '')}`);
      await esperar(2000);
      const ev = recibidos.filter((r) => r.evento === 'pedido:cancelado' && r.p?.pedidoId === b.data.pedidoId);
      for (const r of ev) console.log(`    +${r.t - t0} ms  ${r.evento}  ${JSON.stringify(r.p)}`);
      chk('el cliente recibio pedido:cancelado en su propia sala (< 10 s)', ev.length > 0 && (ev[0].t - t0) < 10_000, ev.length ? `+${ev[0].t - t0}ms` : 'NADA');
      chk('el payload trae estado CANCELADO', ev[0]?.p?.estado === 'CANCELADO', JSON.stringify(ev[0]?.p));
    }
  } finally {
    socket.close();
    await borrar(ids);
    await prisma.$disconnect();
  }

  console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
