/**
 * El EVENTO DE SALDO de una VISITA APROBADA, por el camino REAL y con el socket del cliente.
 *
 *   pnpm --filter @mi-saas/backend test:ws-saldo-aprobar
 *   API_URL=https://api.clubio.lat pnpm --filter @mi-saas/backend test:ws-saldo-aprobar
 *
 * Por que existe: el aviso `saldo:cambiado` de la aprobacion se emitia DESDE ADENTRO de la
 * transaccion (via `fidelizacion.acreditar`), asi que un rollback podia dejar al cliente avisado de
 * un saldo que nunca cambio (y su auditoria escrita igual, porque va por la conexion global). Ahora
 * el evento sale DESPUES del commit: esta sonda prueba las dos cosas a la vez —que siga llegando y
 * que lleve los valores DEFINITIVOS— y que el par del evento coincida con la respuesta del endpoint.
 *
 * Crea un cliente descartable en el tenant, abre el socket en la sala `cliente:{id}`, pide la visita,
 * la aprueba por la API con un token de staff y verifica el evento + la auditoria + el saldo. Borra
 * TODO en el `finally` (cliente, visita, token, tarjeta, premios, auditoria, logs de disparos).
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { io } = require(require.resolve('socket.io-client', {
  paths: [require('path').join(__dirname, '../pwa-staff')],
}));

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = 'que-lomitos';
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
  const res = await fetch(API + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

(async () => {
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true } });
  const negocioId = negocio.id;
  const sucursal = await prisma.sucursal.findFirst({ where: { negocioId, esPrincipal: true, activa: true }, select: { id: true } });
  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  const cfg = await prisma.configuracionClub.findUnique({
    where: { negocioId }, select: { puntosPorMil: true, modoFidelizacion: true },
  });
  const neg = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { modoClientes: true } });

  const RUN = Date.now().toString(36);
  const cliente = await prisma.cliente.create({
    data: { negocioId, nombre: `TEST ws aprobar ${RUN}`, telefono: `+54911${RUN.slice(-6)}${Math.floor(Math.random() * 900) + 100}`, aceptaNotificaciones: false },
    select: { id: true },
  });
  const clienteId = cliente.id;
  await prisma.tarjetaClienteSucursal.upsert({
    where: { clienteId_sucursalId: { clienteId, sucursalId: sucursal.id } },
    update: { sellosActuales: 0, puntosActuales: 0 },
    create: { clienteId, sucursalId: sucursal.id },
  });

  let socket = null;
  const eventos = [];
  try {
    const staffToken = firmar(
      { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
      process.env.JWT_EMPLEADO_SECRET,
    );
    const cliToken = firmar({ sub: clienteId, tipo: 'cliente', negocioId, negocioSlug: SLUG }, process.env.JWT_CLIENTE_SECRET);

    socket = io(`${API}/visitas`, {
      transports: ['websocket'],
      auth: { token: cliToken },
    });
    socket.on('saldo:cambiado', (p) => eventos.push({ evento: 'saldo:cambiado', p }));
    socket.on('visita:aprobada', (p) => eventos.push({ evento: 'visita:aprobada', p }));
    const handshake = await new Promise((resolve) => {
      const to = setTimeout(() => resolve({ error: 'timeout' }), 12000);
      socket.on('conectado', (d) => { clearTimeout(to); resolve(d); });
      socket.on('connect_error', (e) => { clearTimeout(to); resolve({ error: e.message }); });
    });
    chk('el socket del cliente conecta a /visitas', !!handshake && !handshake.error, JSON.stringify(handshake).slice(0, 160));

    const sol = await req('POST', '/api/visitas/solicitar', { token: cliToken, body: { origen: 'qr_club', sucursalId: sucursal.id } });
    chk('solicitar responde 201 con token', sol.status === 201 && !!sol.data?.token, `status=${sol.status}`);

    const ap = await req('POST', `/api/visitas/aprobar/${sol.data.token}`, {
      token: staffToken, body: { origen: 'staff', montoConsumido: 2000 },
    });
    chk('aprobar responde 201', ap.status === 201, `status=${ap.status} ${JSON.stringify(ap.data).slice(0, 200)}`);

    // Esperar el evento (el aviso se emite DESPUES del commit: llega en el mismo request o un pelo
    // despues; se le da margen y se lee lo que haya llegado).
    await new Promise((r) => setTimeout(r, 4000));

    const saldo = eventos.find((e) => e.evento === 'saldo:cambiado' && e.p.motivo === 'visita_aprobada');
    const esperadoPuntos = Math.floor((2000 / 1000) * (cfg?.puntosPorMil ?? 5));
    const esperadoSellos = cfg?.modoFidelizacion === 'SOLO_PUNTOS' ? 0 : 1;
    chk('llego `saldo:cambiado` con motivo visita_aprobada (post-commit)', !!saldo, JSON.stringify(eventos.map((e) => e.evento)));
    chk('el evento trae los sellos/puntos REALES de la acreditacion',
      saldo?.p.sellos === esperadoSellos && saldo?.p.puntos === esperadoPuntos,
      `sellos=${saldo?.p.sellos} (esperado ${esperadoSellos}) puntos=${saldo?.p.puntos} (esperado ${esperadoPuntos})`);
    chk('el par antes/despues del evento coincide con la respuesta del endpoint',
      saldo?.p.saldo?.despues?.sellos === ap.data?.sellosActuales && saldo?.p.saldo?.despues?.puntos === ap.data?.puntosActuales,
      JSON.stringify({ evento: saldo?.p.saldo, respuesta: { sellos: ap.data?.sellosActuales, puntos: ap.data?.puntosActuales } }));
    chk('el `ref` del evento es la visita acreditada', saldo?.p.ref === ap.data?.visitaId, `ref=${saldo?.p.ref} visitaId=${ap.data?.visitaId}`);
    chk('tambien llego `visita:aprobada` al cliente', eventos.some((e) => e.evento === 'visita:aprobada'));

    const audit = await prisma.eventoAuditoria.findFirst({
      where: { clienteId, accion: 'saldo.cambiado' }, orderBy: { creadoEn: 'desc' },
    });
    chk('quedo la auditoria `saldo.cambiado` (post-commit)', !!audit, JSON.stringify(audit?.detalle).slice(0, 200));

    const cli = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { sellosActuales: true, puntosActuales: true, totalVisitas: true, etiqueta: true } });
    chk('el cliente quedo con el saldo acreditado', cli.sellosActuales === esperadoSellos && cli.puntosActuales === esperadoPuntos, JSON.stringify(cli));
    console.log(`\nTOTAL: ${ok} OK, ${falla} FALLA`);
  } finally {
    try {
      if (socket) socket.disconnect();
      await prisma.disparoPushLog.deleteMany({ where: { clienteId } }).catch(() => undefined);
      await prisma.premioOtorgado.deleteMany({ where: { clienteId } });
      await prisma.visita.deleteMany({ where: { clienteId } });
      await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
      await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } });
      await prisma.eventoAuditoria.deleteMany({ where: { clienteId } });
      await prisma.cliente.delete({ where: { id: clienteId } });
      console.log('limpieza OK');
    } catch (e) {
      console.error(`LIMPIEZA INCOMPLETA: ${e.message} (clienteId=${clienteId})`);
    }
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(`FALLO: ${e.stack || e.message}`); process.exitCode = 1; });
