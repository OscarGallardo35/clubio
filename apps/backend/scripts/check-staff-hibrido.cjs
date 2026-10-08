/**
 * Harness del modo HIBRIDO visto desde el STAFF.
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:staff-hibrido
 *
 * Por que existe ademas de `test:hibrido`: aquel acredita y canjea con un token de DUEÑO firmado;
 * esto recorre el camino REAL del staff, que es otro:
 *   - login por PIN (María, ENCARGADO del seed) -> token de EMPLEADO,
 *   - `GET /configuracion/efectiva` (la pantalla del staff lee de ahi el modo y la tasa),
 *   - `POST /visitas/aprobar/:token` con y sin monto,
 *   - `POST /visitas/canjear` con y sin saldo.
 *
 * Crea su propio cliente ('Test Staff Hibrido') y sus tokens en la base, y RESTAURA la config y
 * borra todo al final. Una corrida cortada no rompe la siguiente (limpia restos al arrancar).
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const CLIENTE_PRUEBA = 'Test Staff Hibrido';
const TEL_PRUEBA = '+5491112340093';
// PIN del seed para Maria Encargada (ver prisma/seed.ts). Se puede pisar por entorno.
const PIN = process.env.PIN_ENCARGADO || '1111';

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

async function saldos(clienteId, sucursalId) {
  const [c, t] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { sellosActuales: true, puntosActuales: true } }),
    prisma.tarjetaClienteSucursal.findUnique({
      where: { clienteId_sucursalId: { clienteId, sucursalId } },
      select: { sellosActuales: true, puntosActuales: true },
    }),
  ]);
  return { sellos: c.sellosActuales, puntos: c.puntosActuales };
}

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true, modoClientes: true } });
  const sucursal = await prisma.sucursal.findFirst({
    where: { negocioId: negocio.id, esPrincipal: true }, select: { id: true },
  });
  const original = await prisma.configuracionClub.findUnique({
    where: { negocioId: negocio.id },
    select: { modoFidelizacion: true, puntosPorMil: true, premioPorPuntos: true },
  });

  // Limpieza previa (una corrida cortada deja el cliente y rompe el unique del telefono).
  const previos = await prisma.cliente.findMany({ where: { negocioId: negocio.id, nombre: CLIENTE_PRUEBA }, select: { id: true } });
  for (const previo of previos) {
    await prisma.pedido.deleteMany({ where: { clienteId: previo.id } }).catch(() => undefined);
    await prisma.visita.deleteMany({ where: { clienteId: previo.id } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: previo.id } }).catch(() => undefined);
    await prisma.tokenValidacion.deleteMany({ where: { clienteId: previo.id } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: previo.id } }).catch(() => undefined);
  }

  const cliente = await prisma.cliente.create({
    data: { negocioId: negocio.id, nombre: CLIENTE_PRUEBA, telefono: TEL_PRUEBA },
    select: { id: true },
  });

  async function crearToken() {
    return prisma.tokenValidacion.create({
      data: {
        negocioId: negocio.id, clienteId: cliente.id, sucursalId: sucursal.id,
        token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
        expiraEn: new Date(Date.now() + 5 * 60 * 1000), usado: false,
      },
      select: { token: true },
    });
  }

  try {
    // ---- login por PIN (el camino real del staff) ----
    console.log('[1] login del staff por PIN');
    const login = await req('POST', '/api/auth/empleado/login', { negocioSlug: SLUG, pin: PIN });
    const staff = login.data?.accessToken;
    chk('login por PIN', Boolean(staff), `status=${login.status} rol=${login.data?.empleado?.rol ?? '?'}`);
    if (!staff) throw new Error('sin token de staff: no puedo seguir');
    chk('es ENCARGADO (puede aprobar y canjear)', login.data?.empleado?.rol === 'ENCARGADO', String(login.data?.empleado?.rol));

    // ---- config efectiva (lo que lee la pantalla del staff) ----
    console.log('\n[2] GET /configuracion/efectiva (lo que usa la pantalla)');
    await prisma.configuracionClub.update({
      where: { negocioId: negocio.id },
      data: { modoFidelizacion: 'HIBRIDO', puntosPorMil: 5, premioPorPuntos: 100 },
    });
    let cfg = await req('GET', '/api/configuracion/efectiva', undefined, staff);
    chk('responde 200', cfg.status === 200, `status=${cfg.status}`);
    chk('dice HIBRIDO', cfg.data?.modoFidelizacion === 'HIBRIDO', String(cfg.data?.modoFidelizacion));
    chk('dice tasa 5', cfg.data?.puntosPorMil === 5, String(cfg.data?.puntosPorMil));
    chk('dice umbral 100', cfg.data?.premioPorPuntos === 100, String(cfg.data?.premioPorPuntos));

    // ---- aprobar CON monto ----
    console.log('\n[3] aprobar con monto 6800 (HIBRIDO)');
    let antes = await saldos(cliente.id, sucursal.id);
    const t1 = await crearToken();
    const r1 = await req('POST', `/api/visitas/aprobar/${t1.token}`, { montoConsumido: 6800 }, staff);
    let desp = await saldos(cliente.id, sucursal.id);
    chk('aprobar responde 2xx', r1.status === 200 || r1.status === 201, `status=${r1.status}`);
    chk('la respuesta dice +1 sello', r1.data?.sellosOtorgados === 1, String(r1.data?.sellosOtorgados));
    chk('la respuesta dice +34 puntos', r1.data?.puntosOtorgados === 34, String(r1.data?.puntosOtorgados));
    chk('el cliente sumo 34 puntos', desp.puntos - antes.puntos === 34, `puntos ${antes.puntos} -> ${desp.puntos}`);

    // ---- aprobar SIN monto (gracia) ----
    console.log('\n[4] aprobar sin monto (gracia)');
    antes = await saldos(cliente.id, sucursal.id);
    const t2 = await crearToken();
    const r2 = await req('POST', `/api/visitas/aprobar/${t2.token}`, {}, staff);
    desp = await saldos(cliente.id, sucursal.id);
    chk('aprobar responde 2xx', r2.status === 200 || r2.status === 201, `status=${r2.status}`);
    chk('+1 sello igual', r2.data?.sellosOtorgados === 1, String(r2.data?.sellosOtorgados));
    chk('0 puntos sin monto', r2.data?.puntosOtorgados === 0, String(r2.data?.puntosOtorgados));

    // ---- canjear lo que alcanza (sellos: ya hay 2, hacen falta 10 -> no alcanza) ----
    console.log('\n[5] canjear PUNTOS con saldo (34 < 100 -> 400) y despues con saldo real');
    const corto = await req('POST', '/api/visitas/canjear', { clienteId: cliente.id, tipo: 'PUNTOS' }, staff);
    chk('con 34 puntos y umbral 100 -> 400', corto.status === 400, `status=${corto.status} ${JSON.stringify(corto.data?.message ?? '')}`);

    await prisma.cliente.update({ where: { id: cliente.id }, data: { puntosActuales: 120 } });
    await prisma.tarjetaClienteSucursal.updateMany({
      where: { clienteId: cliente.id, sucursalId: sucursal.id }, data: { puntosActuales: 120 },
    });
    antes = await saldos(cliente.id, sucursal.id);
    const canje = await req('POST', '/api/visitas/canjear', { clienteId: cliente.id, tipo: 'PUNTOS' }, staff);
    desp = await saldos(cliente.id, sucursal.id);
    chk('canje responde 2xx', canje.status === 200 || canje.status === 201, `status=${canje.status}`);
    chk('resta los 100 puntos', antes.puntos - desp.puntos === 100, `puntos ${antes.puntos} -> ${desp.puntos}`);
    chk('devuelve el saldo restante', desp.puntos === 20, String(desp.puntos));

    // ---- canjear SELLOS sin saldo ----
    console.log('\n[6] canjear SELLOS sin saldo -> 400');
    await prisma.cliente.update({ where: { id: cliente.id }, data: { sellosActuales: 0 } });
    await prisma.tarjetaClienteSucursal.updateMany({
      where: { clienteId: cliente.id, sucursalId: sucursal.id }, data: { sellosActuales: 0 },
    });
    const sinSaldo = await req('POST', '/api/visitas/canjear', { clienteId: cliente.id, tipo: 'SELLOS' }, staff);
    chk('responde 400', sinSaldo.status === 400, `status=${sinSaldo.status} ${JSON.stringify(sinSaldo.data?.message ?? '')}`);
  } finally {
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
