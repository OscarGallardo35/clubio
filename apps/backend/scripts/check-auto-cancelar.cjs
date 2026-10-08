/**
 * Auto-cancelado de pedidos PENDIENTE abandonados (> 6 h sin que el local los confirme).
 *
 * El cron corre cada hora; aca se invoca el MISMO metodo por el endpoint de mantenimiento
 * (`POST /pedidos/mantenimiento/auto-cancelar`, solo DUENO), porque esperar a la hora en punto
 * no es testeable. Las tres aserciones que importan:
 *
 *   1. PENDIENTE con creadoEn de hace 7 h  -> CANCELADO + motivoRechazo 'Auto-cancelado por inactividad'.
 *   2. PENDIENTE fresco                    -> NO se toca.
 *   3. CONFIRMADO con creadoEn de hace 7 h -> NO se toca (el local ya lo acepto: moverlo es su
 *      responsabilidad, y cancelar un delivery en curso seria peor).
 *
 * Y la idempotencia: una segunda corrida no cambia nada.
 *
 *   pnpm --filter backend test:auto-cancelar                                   (localhost:3000)
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:auto-cancelar
 *
 * Necesita `JWT_DUENO_SECRET` (firma el token a mano, sin login con 2FA; mismo payload que
 * `loginDueno` y lo valida `StaffGuard`). Telefono unico por corrida: el telefono es la
 * identidad del guest. Los 3 pedidos se borran en un `finally`.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const SECRET = process.env.JWT_DUENO_SECRET;
const MOTIVO = 'Auto-cancelado por inactividad';
const HORAS = 6;

const prisma = new PrismaClient();
let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function firmarDueno(payload, secret) {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${b64u(createHmac('sha256', secret).update(cuerpo).digest())}`;
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
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

(async () => {
  if (!SECRET) {
    console.log('FALTA JWT_DUENO_SECRET en el entorno.');
    process.exit(2);
  }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { id: true, nombre: true },
  });
  if (!dueno) {
    console.log('No encontre un DUENO activo para el tenant.');
    process.exit(2);
  }
  const token = firmarDueno(
    { sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG, rol: 'DUENO', tipo: 'dueno', jti: randomUUID() },
    SECRET,
  );
  console.log(`dueno: ${dueno.nombre} (${dueno.id})\n`);

  const carta = await req('GET', '/api/carta?sucursalSlug=centro');
  const coca = buscarItem(carta.data, []).find((i) => /coca/i.test(i.nombre));
  if (!coca) { console.log('No encontre un item de la carta.'); process.exit(2); }

  const telUnico = () => `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
  const crear = (nombre, tel) => req('POST', '/api/pedidos', {
    tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', nombreCliente: nombre, telefono: tel,
    items: [{ itemId: coca.id, cantidad: 1 }],
  });
  const leer = (id) => prisma.pedido.findUnique({
    where: { id }, select: { estado: true, motivoRechazo: true, creadoEn: true },
  });

  const ids = [];
  try {
    const viejo = await crear('Harness AutoCancel viejo', telUnico());
    const fresco = await crear('Harness AutoCancel fresco', telUnico());
    const confirmado = await crear('Harness AutoCancel confirmado', telUnico());
    chk('los 3 pedidos de prueba se crean (201)', [viejo, fresco, confirmado].every((r) => r.status === 201),
      `${viejo.status}/${fresco.status}/${confirmado.status}`);
    for (const p of [viejo, fresco, confirmado]) if (p.data?.pedidoId) ids.push(p.data.pedidoId);
    // `throw` y no `process.exit`: exit saltea el `finally` y deja los pedidos de prueba en la DB.
    if (ids.length !== 3) throw new Error('No pude resolver los ids de los 3 pedidos; abandono.');

    const confirma = await req('PATCH', `/api/pedidos/${confirmado.data.pedidoId}/estado`, { estado: 'CONFIRMADO' }, token);
    chk('el 3ro pasa a CONFIRMADO (via API)', [200, 201].includes(confirma.status), `status=${confirma.status}`);

    // Retrocedo el reloj de los dos "viejos": uno PENDIENTE y uno CONFIRMADO.
    const hace7h = new Date(Date.now() - 7 * 3_600_000);
    await prisma.pedido.updateMany({
      where: { id: { in: [viejo.data.pedidoId, confirmado.data.pedidoId] } }, data: { creadoEn: hace7h },
    });
    const retro = await leer(viejo.data.pedidoId);
    chk(`el PENDIENTE quedo con creadoEn de hace mas de ${HORAS} h`,
      Date.now() - retro.creadoEn.getTime() > HORAS * 3_600_000, `${retro.creadoEn.toISOString()}`);

    // (1) El cron horario, invocado a mano.
    const r1 = await req('POST', '/api/pedidos/mantenimiento/auto-cancelar', {}, token);
    chk('POST /pedidos/mantenimiento/auto-cancelar -> 200/201', [200, 201].includes(r1.status), `status=${r1.status}`);
    chk('reporta al menos 1 cancelado', Number(r1.data?.cancelados) >= 1, JSON.stringify(r1.data));

    // (2) Quien se cancela y quien no.
    const pViejo = await leer(viejo.data.pedidoId);
    chk('PENDIENTE viejo -> CANCELADO', pViejo.estado === 'CANCELADO', `estado=${pViejo.estado}`);
    chk('con motivoRechazo explicativo', pViejo.motivoRechazo === MOTIVO, JSON.stringify(pViejo.motivoRechazo));
    const pFresco = await leer(fresco.data.pedidoId);
    chk('PENDIENTE fresco -> NO se toca', pFresco.estado === 'PENDIENTE', `estado=${pFresco.estado}`);
    const pConf = await leer(confirmado.data.pedidoId);
    chk('CONFIRMADO viejo -> NO se toca', pConf.estado === 'CONFIRMADO', `estado=${pConf.estado}`);

    // (3) Idempotencia.
    const r2 = await req('POST', '/api/pedidos/mantenimiento/auto-cancelar', {}, token);
    chk('segunda corrida -> 200/201', [200, 201].includes(r2.status), `status=${r2.status}`);
    chk('el cancelado sigue CANCELADO', (await leer(viejo.data.pedidoId)).estado === 'CANCELADO');
    chk('el fresco sigue PENDIENTE', (await leer(fresco.data.pedidoId)).estado === 'PENDIENTE');
    chk('el CONFIRMADO sigue CONFIRMADO', (await leer(confirmado.data.pedidoId)).estado === 'CONFIRMADO');
  } finally {
    if (ids.length) {
      const del = await prisma.pedido.deleteMany({ where: { id: { in: ids } } });
      console.log(`\ncleanup: ${del.count} pedido(s) de prueba borrados`);
    }
    await prisma.$disconnect();
  }

  console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
