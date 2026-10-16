/**
 * El PEDIDO ENTREGADO que acredita saldo: la transaccion de `PedidosService.cambiarEstado`.
 *
 *   pnpm --filter @mi-saas/backend test:pedido-entregado
 *   API_URL=https://api.clubio.lat pnpm --filter @mi-saas/backend test:pedido-entregado
 *
 * Por que existe: `cambiarEstado` es la transaccion que en produccion MORIA con
 * `PrismaClientKnownRequestError: Transaction already closed ... 5000 ms`, porque adentro del callback
 * se resolvia la config con el cliente GLOBAL y se emitia el aviso de saldo (con su auditoria). Ahora
 * la config y el `totalVisitas` del cliente se leen ANTES, el aviso sale DESPUES del commit y la
 * transaccion solo tiene trabajo atomico.
 *
 * Verifica por el camino REAL (API de staff) y con TRES entregas (la primera paga los caminos frios:
 * pool de Prisma y cache de config): el pedido entregado acredita sellos/puntos, deja el vinculo
 * visita<->pedido (candado anti doble acreditacion), escribe la auditoria del pedido y la del saldo,
 * y NO se puede volver a acreditar (ENTREGADO es terminal). Todo descartable, borrado en el `finally`.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const ENTREGAS = Number(process.env.ENTREGAS || 3);
const prisma = new PrismaClient();

let ok = 0, falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};

const b64 = (b) => Buffer.from(b).toString('base64url');
function firmar(payload, secret) {
  const ahora = Math.floor(Date.now() / 1000);
  const c = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ ...payload, jti: randomUUID(), iat: ahora, exp: ahora + 3600 }),
  )}`;
  return `${c}.${b64(createHmac('sha256', secret).update(c).digest())}`;
}

async function req(method, p, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(API + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data, ms: Math.round(performance.now() - t0) };
}

(async () => {
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG, activo: true }, select: { id: true } });
  const negocioId = negocio.id;
  const sucursal = await prisma.sucursal.findFirst({ where: { negocioId, esPrincipal: true, activa: true }, select: { id: true } });
  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  const cfg = await prisma.configuracionClub.findUnique({
    where: { negocioId }, select: { puntosPorMil: true, modoFidelizacion: true },
  });
  const esperadoSellos = cfg?.modoFidelizacion === 'SOLO_PUNTOS' ? 0 : 1;
  const TOTAL = 2000;
  const esperadoPuntos = Math.floor((TOTAL / 1000) * (cfg?.puntosPorMil ?? 5));

  const RUN = Date.now().toString(36);
  const inicio = new Date();
  const cliente = await prisma.cliente.create({
    data: { negocioId, nombre: `TEST pedido entregado ${RUN}`, telefono: `+54911${RUN.slice(-6)}${Math.floor(Math.random() * 900) + 100}`, aceptaNotificaciones: false },
    select: { id: true },
  });
  const clienteId = cliente.id;
  await prisma.tarjetaClienteSucursal.upsert({
    where: { clienteId_sucursalId: { clienteId, sucursalId: sucursal.id } },
    update: { sellosActuales: 0, puntosActuales: 0 },
    create: { clienteId, sucursalId: sucursal.id },
  });

  const pedidos = [];
  const mkPedido = async () => {
    // El pedido nace LISTO (los pasos previos no son el objeto de esta prueba) para poder pasar a
    // ENTREGADO, que es la transicion que acredita.
    const p = await prisma.pedido.create({
      data: {
        negocioId, sucursalId: sucursal.id, clienteId,
        nombreCliente: `TEST ${RUN}`, telefono: `+54911${RUN.slice(-6)}000`,
        tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', items: [],
        subtotal: TOTAL, total: TOTAL, estado: 'LISTO',
      },
      select: { id: true },
    });
    pedidos.push(p.id);
    return p.id;
  };

  try {
    const staffToken = firmar(
      { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
      process.env.JWT_EMPLEADO_SECRET,
    );

    const tiempos = [];
    for (let i = 0; i < ENTREGAS; i++) {
      const pedidoId = await mkPedido();
      const r = await req('PATCH', `/api/pedidos/${pedidoId}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
      tiempos.push(r.ms);
      chk(`[${i + 1}] PATCH LISTO -> ENTREGADO responde 200 (antes: 500 por Transaction already closed)`,
        r.status === 200, `status=${r.status} en ${r.ms} ms`);
    }
    const orden = [...tiempos].sort((a, b) => a - b);
    console.log(`  -> tiempos de cambiarEstado: ${tiempos.join('ms  ')}ms   (min ${orden[0]}ms)   [la 1ra paga el camino frio]`);

    const cli = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { sellosActuales: true, puntosActuales: true, totalVisitas: true, etiqueta: true } });
    chk('el cliente quedo acreditado una vez por pedido', cli.sellosActuales === esperadoSellos * ENTREGAS && cli.puntosActuales === esperadoPuntos * ENTREGAS && cli.totalVisitas === ENTREGAS,
      `${JSON.stringify(cli)} (esperado sellos=${esperadoSellos * ENTREGAS} puntos=${esperadoPuntos * ENTREGAS} visitas=${ENTREGAS})`);

    const visitas = await prisma.visita.findMany({ where: { clienteId }, select: { id: true, pedidoId: true, metodo: true, montoConsumido: true } });
    chk('se creo UNA visita por pedido, con el vinculo 1-1 (candado anti doble acreditacion)',
      visitas.length === ENTREGAS && visitas.every((v) => v.metodo === 'PEDIDO' && pedidos.includes(v.pedidoId)),
      JSON.stringify(visitas.map((v) => ({ pedido: !!v.pedidoId, metodo: v.metodo, monto: String(v.montoConsumido) }))));

    // La auditoria del pedido NO lleva `clienteId` (comportamiento previo: la accion es del pedido), asi
    // que se cuenta por accion + ventana; la del saldo SI lleva clienteId.
    const auditPedido = await prisma.eventoAuditoria.count({ where: { negocioId, accion: 'pedido.entregado', creadoEn: { gte: inicio } } });
    const auditSaldo = await prisma.eventoAuditoria.count({ where: { clienteId, accion: 'saldo.cambiado' } });
    chk('quedaron las auditorias de los pedidos y la del saldo (post-commit)',
      auditPedido === ENTREGAS && auditSaldo === ENTREGAS,
      `pedido.entregado=${auditPedido} (esperado ${ENTREGAS}) saldo.cambiado=${auditSaldo} (esperado ${ENTREGAS})`);

    const detalleSaldo = await prisma.eventoAuditoria.findFirst({
      where: { clienteId, accion: 'saldo.cambiado' }, orderBy: { creadoEn: 'desc' }, select: { detalle: true },
    });
    chk('la auditoria del saldo dice que lo movio un pedido entregado', detalleSaldo?.detalle?.motivo === 'pedido_entregado',
      JSON.stringify(detalleSaldo?.detalle).slice(0, 200));

    const ultimoPedido = pedidos[pedidos.length - 1];
    const deNuevo = await req('PATCH', `/api/pedidos/${ultimoPedido}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    chk('volver a ENTREGARLO NO se puede acreditar dos veces (400, ENTREGADO es terminal)', deNuevo.status === 400, `status=${deNuevo.status}`);
    const cli2 = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { sellosActuales: true, puntosActuales: true, totalVisitas: true } });
    chk('el saldo NO cambio con el segundo intento',
      cli2.sellosActuales === cli.sellosActuales && cli2.puntosActuales === cli.puntosActuales && cli2.totalVisitas === cli.totalVisitas,
      JSON.stringify(cli2));
    chk('y el pedido sigue con UNA sola visita', (await prisma.visita.count({ where: { pedidoId: ultimoPedido } })) === 1);

    console.log(`\nTOTAL: ${ok} OK, ${falla} FALLA`);
  } finally {
    try {
      await prisma.disparoPushLog.deleteMany({ where: { clienteId } }).catch(() => undefined);
      await prisma.premioOtorgado.deleteMany({ where: { clienteId } });
      await prisma.visita.deleteMany({ where: { clienteId } });
      await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
      await prisma.pedido.deleteMany({ where: { id: { in: pedidos } } });
      await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } });
      await prisma.eventoAuditoria.deleteMany({ where: { clienteId } });
      await prisma.cliente.delete({ where: { id: clienteId } });
      console.log(`limpieza OK (cliente ${clienteId}, pedidos ${pedidos.length})`);
    } catch (e) {
      console.error(`LIMPIEZA INCOMPLETA: ${e.message} (clienteId=${clienteId} pedidos=${pedidos.join(',')})`);
    }
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(`FALLO: ${e.stack || e.message}`); process.exitCode = 1; });
