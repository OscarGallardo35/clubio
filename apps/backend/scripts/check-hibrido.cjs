/**
 * Harness del modo de fidelizacion HIBRIDO (sellos + puntos por consumo).
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:hibrido
 *
 * Que prueba (el contrato completo, no el calculo suelto):
 *   1. HIBRIDO   + puntosPorMil=5 + monto 6800  -> +1 sello  +34 puntos
 *   2. SOLO_PUNTOS                 + monto 6800 ->  0 sellos +34 puntos
 *   3. SOLO_VISITAS                + monto 6800 -> +1 sello   0 puntos
 *   4. HIBRIDO sin monto (gracia)               -> +1 sello   0 puntos
 *   5. Pedido ENTREGADO con cliente             -> +1 sello  +N puntos
 *   6. Pedido ENTREGADO de invitado (sin cliente) -> nada
 *   7. Canjear PUNTOS con saldo                 -> resta y suma premiosCanjeados
 *   8. Canjear SELLOS sin saldo                 -> 400
 *
 * COMO consigue un cliente y un token sin pedirle nada a nadie:
 *   - El cliente lo crea directo en la base (nombre 'Test Hibrido', telefono del rango de los
 *     harness). No toca el seed.
 *   - El token de validacion tambien lo crea la base: lo que se prueba es la APROBACION (el
 *     endpoint real), no el flujo de solicitud (que ya cubren otros harness).
 *   - El token de dueño se firma con `JWT_DUENO_SECRET` (el mismo que usa el backend). El login
 *     real de dueño pide password + 2FA, que un harness no puede hacer.
 *
 * RESTAURA todo al final (config + cliente, en cascada). Correrlo dos veces seguidas da lo mismo.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// dotenv-lite: el .env de la raiz, sin dependencias.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const linea of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const prisma = new PrismaClient();
const API = (process.env.API_URL || 'https://api.clubio.lat').replace(/\/$/, '');
const SLUG = 'bar-la-esquina';
const CLIENTE_PRUEBA = 'Test Hibrido';
const TEL_PRUEBA = '+5491112340091';

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

async function req(method, ruta, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + ruta, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

/** Firma un JWT HS256 con el secreto de dueño del backend. */
function firmarDueno(empleadoId, negocioId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: empleadoId, negocioId, negocioSlug: SLUG, rol: 'DUENO',
    sucursalId: null, tipo: 'dueno', jti: crypto.randomUUID(),
    iat: ahora, exp: ahora + 1800,
  });
  const firma = crypto.createHmac('sha256', process.env.JWT_DUENO_SECRET)
    .update(`${cabecera}.${payload}`).digest('base64url');
  return `${cabecera}.${payload}.${firma}`;
}

/** Crea un token de validacion vivo para el cliente (lo que prueba es la APROBACION). */
async function crearToken(negocioId, clienteId, sucursalId) {
  return prisma.tokenValidacion.create({
    data: {
      negocioId, clienteId, sucursalId,
      token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
      expiraEn: new Date(Date.now() + 5 * 60 * 1000),
      usado: false,
    },
    select: { token: true },
  });
}

async function saldos(clienteId, sucursalId) {
  const [c, t] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { sellosActuales: true, puntosActuales: true, premiosCanjeados: true } }),
    prisma.tarjetaClienteSucursal.findUnique({
      where: { clienteId_sucursalId: { clienteId, sucursalId } },
      select: { sellosActuales: true, puntosActuales: true },
    }),
  ]);
  return { sellos: c.sellosActuales, puntos: c.puntosActuales, premios: c.premiosCanjeados, tarjetaSellos: t?.sellosActuales ?? 0, tarjetaPuntos: t?.puntosActuales ?? 0 };
}

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true, modoClientes: true } });
  if (!negocio) { console.log('No existe el negocio. Abortado.'); process.exit(2); }
  const sucursal = await prisma.sucursal.findFirst({
    where: { negocioId: negocio.id, esPrincipal: true }, select: { id: true },
  });
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null }, select: { id: true },
  });
  if (!sucursal || !dueno) { console.log('Falta sucursal principal o empleado DUENO. Abortado.'); process.exit(2); }

  const original = await prisma.configuracionClub.findUnique({
    where: { negocioId: negocio.id },
    select: { modoFidelizacion: true, puntosPorMil: true, premioPorPuntos: true },
  });
  const duenoToken = firmarDueno(dueno.id, negocio.id);
  const cliente = await prisma.cliente.create({
    data: {
      negocioId: negocio.id, nombre: CLIENTE_PRUEBA, telefono: TEL_PRUEBA,
      aceptaNotificaciones: false, tienePwaInstalada: false,
    },
    select: { id: true },
  });
  const items = await prisma.itemCarta.findMany({
    where: { negocioId: negocio.id, disponible: true }, take: 1, select: { id: true, precio: true },
  });

  /** Deja el club en un modo y una tasa concretos (por el endpoint real). */
  async function config(modo, puntosPorMil, premioPorPuntos) {
    const r = await req('PATCH', '/api/configuracion', {
      modoFidelizacion: modo, puntosPorMil, premioPorPuntos,
    }, duenoToken);
    if (r.status !== 200) { console.log(`  no pude configurar (${modo}): ${r.status} ${JSON.stringify(r.data)}`); process.exit(2); }
  }

  /** Aprueba una visita con un monto y devuelve el body de la respuesta. */
  async function aprobar(monto) {
    const t = await crearToken(negocio.id, cliente.id, sucursal.id);
    const r = await req('POST', `/api/visitas/aprobar/${t.token}`,
      monto === null ? {} : { montoConsumido: monto }, duenoToken);
    return r;
  }

  try {
    // ---------- 1) HIBRIDO ----------
    console.log('[1] HIBRIDO, puntosPorMil=5, monto 6800');
    await config('HIBRIDO', 5, 100);
    let antes = await saldos(cliente.id, sucursal.id);
    let r = await aprobar(6800);
    let desp = await saldos(cliente.id, sucursal.id);
    chk('aprobar responde 200', r.status === 200 || r.status === 201, `status=${r.status}`);
    chk('otorga 1 sello', desp.sellos - antes.sellos === 1, `sellos ${antes.sellos} -> ${desp.sellos}`);
    chk('otorga 34 puntos (6800/1000 * 5)', desp.puntos - antes.puntos === 34, `puntos ${antes.puntos} -> ${desp.puntos}`);
    if (negocio.modoClientes === 'POR_SUCURSAL') {
      chk('la tarjeta de la sucursal tambien suma', desp.tarjetaPuntos - antes.tarjetaPuntos === 34, `tarjeta ${antes.tarjetaPuntos} -> ${desp.tarjetaPuntos}`);
    }

    // ---------- 2) SOLO_PUNTOS ----------
    console.log('\n[2] SOLO_PUNTOS, monto 6800');
    await config('SOLO_PUNTOS', 5, 100);
    antes = await saldos(cliente.id, sucursal.id);
    r = await aprobar(6800);
    desp = await saldos(cliente.id, sucursal.id);
    chk('0 sellos', desp.sellos - antes.sellos === 0, `sellos ${antes.sellos} -> ${desp.sellos}`);
    chk('34 puntos', desp.puntos - antes.puntos === 34, `puntos ${antes.puntos} -> ${desp.puntos}`);

    // ---------- 3) SOLO_VISITAS ----------
    console.log('\n[3] SOLO_VISITAS, monto 6800');
    await config('SOLO_VISITAS', 5, 100);
    antes = await saldos(cliente.id, sucursal.id);
    r = await aprobar(6800);
    desp = await saldos(cliente.id, sucursal.id);
    chk('1 sello', desp.sellos - antes.sellos === 1, `sellos ${antes.sellos} -> ${desp.sellos}`);
    chk('0 puntos (el monto no da puntos en este modo)', desp.puntos - antes.puntos === 0, `puntos ${antes.puntos} -> ${desp.puntos}`);

    // ---------- 4) gracia: sin monto ----------
    console.log('\n[4] HIBRIDO sin monto (gracia)');
    await config('HIBRIDO', 5, 100);
    antes = await saldos(cliente.id, sucursal.id);
    r = await aprobar(null);
    desp = await saldos(cliente.id, sucursal.id);
    chk('1 sello igual', desp.sellos - antes.sellos === 1, `sellos ${antes.sellos} -> ${desp.sellos}`);
    chk('0 puntos sin monto', desp.puntos - antes.puntos === 0, `puntos ${antes.puntos} -> ${desp.puntos}`);

    // ---------- 5) pedido ENTREGADO con cliente ----------
    console.log('\n[5] pedido ENTREGADO con cliente');
    if (items.length === 0) {
      console.log('  (no hay items de carta: salteo el pedido)');
    } else {
      const pedidoConCliente = await prisma.pedido.create({
        data: {
          negocioId: negocio.id, sucursalId: sucursal.id, clienteId: cliente.id,
          tipo: 'TAKEAWAY', nombreCliente: CLIENTE_PRUEBA, telefono: TEL_PRUEBA,
          items: [{ itemCartaId: items[0].id, nombre: 'Test', cantidad: 1, precioUnitario: Number(items[0].precio) }],
          subtotal: 6800, costoEnvio: 0, total: 6800, modoPago: 'EFECTIVO', estado: 'PENDIENTE',
        },
        select: { id: true },
      });
      antes = await saldos(cliente.id, sucursal.id);
      const conf = await req('PATCH', `/api/pedidos/${pedidoConCliente.id}/estado`, { estado: 'CONFIRMADO' }, duenoToken);
      const entreg = await req('PATCH', `/api/pedidos/${pedidoConCliente.id}/estado`, { estado: 'ENTREGADO' }, duenoToken);
      desp = await saldos(cliente.id, sucursal.id);
      chk('el pedido llega a ENTREGADO', conf.status === 200 && entreg.status === 200, `conf=${conf.status} entregado=${entreg.status}`);
      chk('acredita 1 sello', desp.sellos - antes.sellos === 1, `sellos ${antes.sellos} -> ${desp.sellos}`);
      chk('acredita 34 puntos por el total', desp.puntos - antes.puntos === 34, `puntos ${antes.puntos} -> ${desp.puntos}`);
      const visitaPedido = await prisma.visita.findFirst({
        where: { clienteId: cliente.id, metodo: 'PEDIDO' }, select: { id: true, montoConsumido: true },
      });
      chk('queda la Visita con metodo PEDIDO', Boolean(visitaPedido), JSON.stringify(visitaPedido));

      // ---------- 6) pedido ENTREGADO de invitado ----------
      console.log('\n[6] pedido ENTREGADO de invitado (sin cliente)');
      const pedidoGuest = await prisma.pedido.create({
        data: {
          negocioId: negocio.id, sucursalId: sucursal.id, clienteId: null,
          tipo: 'TAKEAWAY', nombreCliente: 'Invitado Test', telefono: '+5491112340092',
          items: [{ itemCartaId: items[0].id, nombre: 'Test', cantidad: 1, precioUnitario: Number(items[0].precio) }],
          subtotal: 6800, costoEnvio: 0, total: 6800, modoPago: 'EFECTIVO', estado: 'PENDIENTE',
        },
        select: { id: true },
      });
      antes = await saldos(cliente.id, sucursal.id);
      await req('PATCH', `/api/pedidos/${pedidoGuest.id}/estado`, { estado: 'CONFIRMADO' }, duenoToken);
      const g = await req('PATCH', `/api/pedidos/${pedidoGuest.id}/estado`, { estado: 'ENTREGADO' }, duenoToken);
      desp = await saldos(cliente.id, sucursal.id);
      chk('el pedido de invitado se entrega igual', g.status === 200, `status=${g.status}`);
      chk('no acredita nada (no hay a quien)', desp.sellos === antes.sellos && desp.puntos === antes.puntos,
        `sellos ${antes.sellos}->${desp.sellos} puntos ${antes.puntos}->${desp.puntos}`);
    }

    // ---------- 7) canje de PUNTOS con saldo ----------
    console.log('\n[7] canjear PUNTOS con saldo');
    antes = await saldos(cliente.id, sucursal.id);
    const canje = await req('POST', '/api/visitas/canjear', { clienteId: cliente.id, tipo: 'PUNTOS' }, duenoToken);
    desp = await saldos(cliente.id, sucursal.id);
    chk('canje responde 200', canje.status === 200 || canje.status === 201, `status=${canje.status} ${JSON.stringify(canje.data?.message ?? '')}`);
    chk('resta los 100 puntos del premio', antes.puntos - desp.puntos === 100, `puntos ${antes.puntos} -> ${desp.puntos}`);
    chk('incrementa premiosCanjeados', desp.premios - antes.premios === 1, `premios ${antes.premios} -> ${desp.premios}`);
    const cl = await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { ultimoCanjeEn: true } });
    chk('deja ultimoCanjeEn', cl.ultimoCanjeEn !== null, String(cl.ultimoCanjeEn));

    // ---------- 8) canje sin saldo ----------
    console.log('\n[8] canjear SELLOS sin saldo');
    await prisma.cliente.update({ where: { id: cliente.id }, data: { sellosActuales: 0 } });
    await prisma.tarjetaClienteSucursal.updateMany({
      where: { clienteId: cliente.id, sucursalId: sucursal.id }, data: { sellosActuales: 0 },
    });
    const sinSaldo = await req('POST', '/api/visitas/canjear', { clienteId: cliente.id, tipo: 'SELLOS' }, duenoToken);
    chk('responde 400 con el saldo en 0', sinSaldo.status === 400, `status=${sinSaldo.status} ${JSON.stringify(sinSaldo.data?.message ?? '')}`);

  } finally {
    // RESTAURA la config original y borra el cliente de prueba (cascada: visitas, pedidos, tarjetas).
    if (original) {
      await prisma.configuracionClub.update({
        where: { negocioId: negocio.id },
        data: {
          modoFidelizacion: original.modoFidelizacion,
          puntosPorMil: original.puntosPorMil,
          premioPorPuntos: original.premioPorPuntos,
        },
      }).catch(() => undefined);
    }
    await prisma.pedido.deleteMany({ where: { clienteId: cliente.id } }).catch(() => undefined);
    await prisma.pedido.deleteMany({ where: { telefono: '+5491112340092' } }).catch(() => undefined);
    await prisma.visita.deleteMany({ where: { clienteId: cliente.id } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: cliente.id } }).catch(() => undefined);
    await prisma.tokenValidacion.deleteMany({ where: { clienteId: cliente.id } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: cliente.id } }).catch(() => undefined);
    console.log('\ncleanup: config restaurada + cliente de prueba borrado');
    console.log(fallos === 0 ? '\nTOTAL OK\n' : `\nTOTAL CON ${fallos} FALLA(S)\n`);
    await prisma.$disconnect();
    process.exit(fallos === 0 ? 0 : 1);
  }
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
