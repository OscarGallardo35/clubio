/**
 * Verificacion end-to-end de los DISPAROS de push (auto-verificable).
 *
 *   pnpm --filter backend test:disparos-push
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:disparos-push
 *
 * Corre contra PROD (API + DB). Cubre:
 *  [1] COMPRA con regalo {sellos:1}: al pasar el pedido a ENTREGADO acredita +1 sello
 *      (una sola vez) y encola el push. Candado por (disparo, cliente, pedido).
 *  [2] limitePorCliente {porDia:1}: el 2do pedido del dia NO acredita.
 *  [3] Un pedido CANCELADO/RECHAZADO no acredita nada.
 *  [4] POST /push/disparos/:id/probar manda el push a un cliente puntual.
 *  [5] El job DIA quedo registrado (job scheduler) y la ventana horaria se evalua
 *      en hora ARGENTINA (un disparo con la hora AR dispara; con la hora UTC no).
 *  [6] SELLOS: el cambio de saldo dispara CADA_SELLO.
 *  [7] BIENVENIDA: el alta de un cliente dispara.
 *
 * Todo lo creado se borra en el `finally`. El token de staff se FIRMA con el
 * secreto del propio repo (no se usa ninguna contrasena de persona).
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const prisma = new PrismaClient();

let ok = 0;
let falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 160) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

async function req(method, p, { body, token, slug } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': slug || SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

// ---- helpers de hora argentina (UTC-3 fijo) ----
const AR_OFFSET = 3 * 60 * 60 * 1000;
const DIAS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
function arNow() {
  const d = new Date(Date.now() - AR_OFFSET);
  const p = (n) => String(n).padStart(2, '0');
  return {
    semana: DIAS[d.getUTCDay()],
    fecha: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    minutos: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
const floor15 = (m) => Math.floor(m / 15) * 15;
const fmt = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

function conectarCola() {
  const raw = process.env.REDIS_URL;
  const u = new URL(raw);
  const isTls = u.protocol === 'rediss:';
  return new (require('bullmq').Queue)('push-disparos', {
    connection: {
      host: u.hostname,
      port: Number(u.port) || (isTls ? 6380 : 6379),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
      maxRetriesPerRequest: null,
    },
  });
}

const RUN = `${Date.now().toString(36)}`;
// telefono unico por corrida (es la identidad del cliente)
const TEL = `+5491100${RUN.slice(-6).padEnd(6, '0')}`;

async function main() {
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG, activo: true }, select: { id: true, nombre: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  if (!empleado) throw new Error('Sin empleado DUENO/ENCARGADO');
  const sucursal = await prisma.sucursal.findFirst({ where: { negocioId, esPrincipal: true, activa: true }, select: { id: true } });

  const secret = process.env.JWT_EMPLEADO_SECRET;
  if (!secret) throw new Error('Falta JWT_EMPLEADO_SECRET en el entorno');
  const staffToken = jwt.sign(
    { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
    secret, { expiresIn: '1h' },
  );
  console.log(`\n== Disparos push :: ${SLUG} :: run ${RUN} :: ${API} ==`);

  // --- recursos a limpiar ---
  const disparos = [];
  const plantillas = [];
  const clientes = [];
  const pedidos = [];
  let realSubsApagadas = [];
  let cola = null;

  try {
    // ==========================================================================
    console.log('\n[5a] Job scheduler DIA/INACTIVIDAD registrado en BullMQ');
    cola = conectarCola();
    const schedulers = await cola.getJobSchedulers().catch(() => []);
    const ids = schedulers.map((s) => s.key || s.id || s.name);
    chk('scheduler disparos-dia registrado', ids.some((i) => String(i).includes('disparos-dia')), trunc(ids));
    chk('scheduler disparos-inactividad registrado', ids.some((i) => String(i).includes('disparos-inactividad')));

    // ==========================================================================
    // Plantilla de prueba
    const pl = await prisma.plantillaPush.create({
      data: { negocioId, nombre: `TEST pl ${RUN}`, titulo: 'Hola {{nombre}}', cuerpo: 'Llevas {{actuales}}/{{meta}} en {{negocio}}', url: '/tarjeta', activa: true },
    });
    plantillas.push(pl.id);

    // Cliente de prueba + suscripcion push (endpoint fake) + tarjeta
    const cliente = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST ${RUN}`, telefono: TEL, aceptaNotificaciones: true, sellosActuales: 0 },
    });
    clientes.push(cliente.id);
    const sub = await prisma.notificacionPush.create({
      data: { negocioId, clienteId: cliente.id, endpoint: `https://example.invalid/webpush/${RUN}`, auth: 'test', p256dh: 'test', activa: true },
    });
    await prisma.tarjetaClienteSucursal.upsert({
      where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id } },
      update: {}, create: { clienteId: cliente.id, sucursalId: sucursal.id },
    });

    // Apago las suscripciones REALES durante la corrida (no spamear clientes reales).
    const reales = await prisma.notificacionPush.findMany({
      where: { negocioId, activa: true, clienteId: { not: cliente.id } }, select: { id: true },
    });
    if (reales.length) {
      await prisma.notificacionPush.updateMany({ where: { id: { in: reales.map((r) => r.id) } }, data: { activa: false } });
      realSubsApagadas = reales.map((r) => r.id);
    }

    // ==========================================================================
    console.log('\n[1] COMPRA con regalo {sellos:1} + limitePorCliente null');
    const dCompra = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST compra ${RUN}`, tipo: 'COMPRA', activa: true, config: { estado: 'ENTREGADO', cadaNCompras: 1 }, plantillaId: pl.id, regalo: { sellos: 1 } },
    });
    disparos.push(dCompra.id);

    // Pedido de prueba en LISTO -> PATCH a ENTREGADO por API (camino real).
    const pedido = await prisma.pedido.create({
      data: {
        negocioId, sucursalId: sucursal.id, clienteId: cliente.id,
        nombreCliente: `TEST ${RUN}`, telefono: TEL, tipo: 'TAKEAWAY', modoPago: 'EFECTIVO',
        items: [], subtotal: 1000, total: 1000, estado: 'LISTO',
      },
    });
    pedidos.push(pedido.id);

    const antes = await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } });
    const r1 = await req('PATCH', `/api/pedidos/${pedido.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    chk('PATCH pedido -> ENTREGADO responde 200', r1.status === 200, `status=${r1.status}`);

    await new Promise((res) => setTimeout(res, 1200)); // deja correr el motor
    const desp = await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } });
    // OJO: en el camino PEDIDO la Visita NO lleva pedidoId (el vinculo 1-1 se arma solo cuando
    // el staff aprueba una visita eligiendo el pedido). Se ubica la visita por cliente+metodo.
    const visita = await prisma.visita.findFirst({
      where: { clienteId: cliente.id, metodo: 'PEDIDO' },
      orderBy: { aprobadoEn: 'desc' },
      select: { id: true, sellosOtorgados: true, pedidoId: true },
    });
    const logCompra = await prisma.disparoPushLog.findMany({ where: { disparoId: dCompra.id, clave: `COMPRA:${pedido.id}` } });
    const auditRegalo = await prisma.eventoAuditoria.count({
      where: { negocioId, accion: 'push.disparo_regalo', clienteId: cliente.id, detalle: { path: ['pedidoId'], equals: pedido.id } },
    });

    chk('el pedido acredito la visita base (metodo PEDIDO, +1 sello)', !!visita && visita.sellosOtorgados >= 1, `sellosOtorgados=${visita?.sellosOtorgados} pedidoId=${visita?.pedidoId}`);
    chk('existe 1 fila-candado COMPRA:<pedido>', logCompra.length === 1, `n=${logCompra.length}`);
    chk('el candado registra +1 sello del regalo', logCompra[0]?.sellosAcreditados === 1, `sellos=${logCompra[0]?.sellosAcreditados}`);
    chk('el candado encolo el push', logCompra[0]?.detalle?.push?.encolados === 1, trunc(logCompra[0]?.detalle?.push));
    chk('hay auditoria del regalo (push.disparo_regalo)', auditRegalo === 1, `n=${auditRegalo}`);
    const delta = desp.sellosActuales - antes.sellosActuales;
    chk('delta de sellos = visita base + 1 regalo', delta === (visita?.sellosOtorgados ?? 0) + 1, `antes=${antes.sellosActuales} despues=${desp.sellosActuales} delta=${delta}`);

    // --- NO doble acreditacion ---
    let p2002 = false;
    try {
      await prisma.disparoPushLog.create({
        data: { disparoId: dCompra.id, negocioId, clienteId: cliente.id, pedidoId: pedido.id, tipo: 'COMPRA', clave: `COMPRA:${pedido.id}`, accion: 'ENVIADO', sellosAcreditados: 1 },
      });
    } catch (e) { p2002 = e.code === 'P2002'; }
    chk('una 2da ejecucion del mismo pedido choca con el candado (P2002)', p2002);

    const rRe = await req('PATCH', `/api/pedidos/${pedido.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    const logCompra2 = await prisma.disparoPushLog.count({ where: { disparoId: dCompra.id, clave: `COMPRA:${pedido.id}` } });
    const desp2 = await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } });
    chk('re-PATCH ENTREGADO rechazado (terminal)', rRe.status === 400, `status=${rRe.status}`);
    chk('sigue habiendo 1 sola fila-candado', logCompra2 === 1);
    chk('los sellos NO volvieron a subir', desp2.sellosActuales === desp.sellosActuales, `${desp.sellosActuales} -> ${desp2.sellosActuales}`);

    // Aislar el resto de la corrida: el disparo COMPRA sin limite ya cumplio su parte.
    await prisma.disparoPush.update({ where: { id: dCompra.id }, data: { activa: false } });

    // ==========================================================================
    console.log('\n[2] limitePorCliente {porDia:1}: el 2do pedido del dia NO acredita');
    const dLim = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST limite ${RUN}`, tipo: 'COMPRA', activa: true, config: { estado: 'ENTREGADO' }, plantillaId: pl.id, regalo: { sellos: 1 }, limitePorCliente: { porDia: 1 } },
    });
    disparos.push(dLim.id);
    const mkPedido = async () => prisma.pedido.create({
      data: { negocioId, sucursalId: sucursal.id, clienteId: cliente.id, nombreCliente: `TEST ${RUN}`, telefono: TEL, tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', items: [], subtotal: 1, total: 1, estado: 'LISTO' },
    });
    const p2 = await mkPedido(); pedidos.push(p2.id);
    const p3 = await mkPedido(); pedidos.push(p3.id);
    const base2 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    await req('PATCH', `/api/pedidos/${p2.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    const nLim1 = await prisma.disparoPushLog.count({ where: { disparoId: dLim.id, accion: 'ENVIADO' } });
    const p2Regalo = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    await req('PATCH', `/api/pedidos/${p3.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    const nLim2 = await prisma.disparoPushLog.count({ where: { disparoId: dLim.id, accion: 'ENVIADO' } });
    const omitidos = await prisma.disparoPushLog.count({ where: { disparoId: dLim.id, accion: 'OMITIDO_LIMITE' } });
    const p3Regalo = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('1er pedido: 1 ENVIADO', nLim1 === 1, `enviados=${nLim1}`);
    chk('2do pedido: sigue 1 ENVIADO (no acredita)', nLim2 === 1, `enviados=${nLim2}`);
    chk('2do pedido: quedo OMITIDO_LIMITE', omitidos >= 1, `omitidos=${omitidos}`);
    const baseVisita = 1; // HIBRIDO / consumo -> la Base acredita 1 sello (no lo limita el disparo)
    chk('2do pedido: acredito SOLO la base (sin el sello del regalo)', (p3Regalo - p2Regalo) === baseVisita, `delta=${p3Regalo - p2Regalo} (esperado ${baseVisita})`);

    // ==========================================================================
    console.log('\n[3] Pedido CANCELADO/RECHAZADO no acredita');
    const pCanc = await prisma.pedido.create({
      data: { negocioId, sucursalId: sucursal.id, clienteId: cliente.id, nombreCliente: `TEST ${RUN}`, telefono: TEL, tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', items: [], subtotal: 1, total: 1, estado: 'CONFIRMADO' },
    });
    pedidos.push(pCanc.id);
    const antesCanc = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    const rC = await req('PATCH', `/api/pedidos/${pCanc.id}/estado`, { token: staffToken, body: { estado: 'CANCELADO' } });
    chk('PATCH -> CANCELADO responde 200', rC.status === 200, `status=${rC.status}`);
    const logCanc = await prisma.disparoPushLog.count({ where: { disparoId: dCompra.id, clave: `COMPRA:${pCanc.id}` } });
    const despCanc = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('no hay ejecucion COMPRA para un pedido cancelado', logCanc === 0);
    chk('el saldo no cambio por el cancelado', despCanc === antesCanc, `${antesCanc} -> ${despCanc}`);

    // ==========================================================================
    console.log('\n[4] POST /push/disparos/:id/probar manda el push a un cliente');
    const rProbar = await req('POST', `/api/push/disparos/${dCompra.id}/probar`, { token: staffToken, body: { clienteId: cliente.id } });
    chk('probar responde 200', rProbar.status === 200 || rProbar.status === 201, `status=${rProbar.status} ${trunc(rProbar.data)}`);
    chk('probar encolo 1 push', rProbar.data?.encolados === 1 || rProbar.data?.prueba === true, trunc(rProbar.data));

    // ==========================================================================
    console.log('\n[6] SELLOS: el cambio de saldo dispara CADA_SELLO');
    const dSellos = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST sellos ${RUN}`, tipo: 'SELLOS', activa: true, config: { cuando: 'CADA_SELLO' }, plantillaId: pl.id },
    });
    disparos.push(dSellos.id);
    const pS = await mkPedido(); pedidos.push(pS.id);
    await req('PATCH', `/api/pedidos/${pS.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    const logSellos = await prisma.disparoPushLog.findMany({ where: { disparoId: dSellos.id, accion: 'ENVIADO' } });
    const visitaS = await prisma.visita.findFirst({ where: { clienteId: cliente.id, metodo: 'PEDIDO' }, orderBy: { aprobadoEn: 'desc' }, select: { id: true } });
    chk('SELLOS se disparo al cambiar el saldo (1 ENVIADO)', logSellos.length === 1, `n=${logSellos.length}`);
    chk('la clave del evento SELLOS es la visita del cambio', logSellos[0]?.clave === `SELLOS:${visitaS?.id}`, trunc(logSellos[0]?.clave));

    // ==========================================================================
    console.log('\n[7] BIENVENIDA: el alta de un cliente dispara');
    const dBien = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST bienvenida ${RUN}`, tipo: 'BIENVENIDA', activa: true, config: {}, plantillaId: pl.id },
    });
    disparos.push(dBien.id);
    const telBien = `+5491100${RUN.slice(-6).padStart(6, '0').split('').reverse().join('')}`;
    const rBien = await req('POST', '/api/auth/cliente/registrar', { body: { negocioSlug: SLUG, nombre: `TEST bien ${RUN}`, telefono: telBien, aceptaNotificaciones: false } });
    chk('registrar cliente responde 200', rBien.status === 200 || rBien.status === 201, `status=${rBien.status} ${trunc(rBien.data)}`);
    if (rBien.data?.cliente?.id) clientes.push(rBien.data.cliente.id);
    await new Promise((res) => setTimeout(res, 800));
    const logBien = rBien.data?.cliente?.id
      ? await prisma.disparoPushLog.findMany({ where: { disparoId: dBien.id, clave: `BIENVENIDA:${rBien.data.cliente.id}` } })
      : [];
    chk('BIENVENIDA se disparo en el alta', logBien.length === 1, `n=${logBien.length}`);

    // ==========================================================================
    console.log('\n[5b] El job DIA evalua la ventana en hora ARGENTINA');
    const ar = arNow();
    const horaAR = fmt(floor15(ar.minutos));
    const horaUTC = fmt(floor15(ar.minutos + 180)); // si el motor usara UTC, matchearia esta
    const dDiaAR = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST dia AR ${RUN}`, tipo: 'DIA', activa: true, config: { dia: ar.semana, hora: horaAR }, plantillaId: pl.id },
    });
    const dDiaUTC = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST dia UTC ${RUN}`, tipo: 'DIA', activa: true, config: { dia: ar.semana, hora: horaUTC }, plantillaId: pl.id },
    });
    disparos.push(dDiaAR.id, dDiaUTC.id);
    console.log(`    AR ahora: ${ar.semana} ${horaAR}  |  hora UTC (si el bug): ${horaUTC}`);
    await cola.add('dia', {}, { removeOnComplete: true, removeOnFail: true });
    await new Promise((res) => setTimeout(res, 2500));
    const logDiaAR = await prisma.disparoPushLog.count({ where: { disparoId: dDiaAR.id, accion: 'ENVIADO' } });
    const logDiaUTC = await prisma.disparoPushLog.count({ where: { disparoId: dDiaUTC.id, accion: 'ENVIADO' } });
    chk('DIA con la hora AR disparo al cliente', logDiaAR === 1, `n=${logDiaAR}`);
    chk('DIA con la hora UTC NO disparo (se evalua en hora AR)', logDiaUTC === 0, `n=${logDiaUTC}`);
  } finally {
    // ==========================================================================
    console.log('\n[8] LIMPIEZA');
    if (cola) await cola.close().catch(() => undefined);
    const pedidosIds = pedidos.slice();
    await prisma.disparoPushLog.deleteMany({ where: { disparoId: { in: disparos } } }).catch(() => undefined);
    await prisma.disparoPush.deleteMany({ where: { id: { in: disparos } } }).catch(() => undefined);
    await prisma.plantillaPush.deleteMany({ where: { id: { in: plantillas } } }).catch(() => undefined);
    await prisma.visita.deleteMany({ where: { pedidoId: { in: pedidosIds } } }).catch(() => undefined);
    await prisma.visita.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tokenValidacion.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.pedido.deleteMany({ where: { id: { in: pedidosIds } } }).catch(() => undefined);
    await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    // Auditoria de la corrida: solo las filas de mis clientes/pedidos de prueba.
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, clienteId: { in: clientes }, accion: { startsWith: 'push.disparo' } },
    }).catch(() => undefined);
    for (const pid of pedidosIds) {
      await prisma.eventoAuditoria.deleteMany({ where: { negocioId, detalle: { path: ['pedidoId'], equals: pid } } }).catch(() => undefined);
    }
    // Restauro las suscripciones reales
    if (realSubsApagadas.length) {
      await prisma.notificacionPush.updateMany({ where: { id: { in: realSubsApagadas } }, data: { activa: true } }).catch(() => undefined);
    }
    console.log('  limpieza: disparos/plantillas/clientes/pedidos/visitas/subs/auditoria de prueba borrados; suscripciones reales restauradas');
  }

  console.log(`\n==== RESULTADO: ${ok} OK / ${falla} FALLA ====`);
  await prisma.$disconnect();
  if (falla > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('\nABORTADO:', e.message);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
