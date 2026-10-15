/**
 * Fixture TEMPORAL para verificar el bloque "Tus premios ganados" en el navegador (375px).
 *
 *   node scripts/fixture-mis-premios.cjs crear
 *   node scripts/fixture-mis-premios.cjs limpiar
 *
 * Crea (o reusa) un cliente de prueba en el negocio del tenant con premios en TODOS los estados
 * —incluido un LIBRE PENDIENTE para el caso grave— y escribe la cookie de sesion del cliente en un
 * archivo FUERA del repo (TMPDIR). El token nunca se imprime.
 *
 * OJO: es una herramienta de verificacion manual, no forma parte de ningun `test:*`.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const RAIZ = path.join(__dirname, '..', '..', '..');

function cargarEnv(archivo, soloSiFalta) {
  const p = path.join(RAIZ, archivo);
  if (!fs.existsSync(p)) return;
  for (const linea of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (soloSiFalta && process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
cargarEnv('.env', true);
cargarEnv('.env.secrets', false);

const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const TEL = '+5491100000919';
const NOMBRE = 'TEST MisPremios';

const prisma = new PrismaClient();

function firmarHS256(payload, secret, expSegundos) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const body = { ...payload, jti: crypto.randomUUID(), iat: ahora, exp: ahora + expSegundos };
  const dato = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  const firma = crypto.createHmac('sha256', secret).update(dato).digest('base64url');
  return `${dato}.${firma}`;
}

async function crear() {
  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true, slug: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const sucursal = await prisma.sucursal.findFirst({
    where: { negocioId: negocio.id, esPrincipal: true, activa: true }, select: { id: true },
  });

  const cliente = await prisma.cliente.upsert({
    where: { negocioId_telefono: { negocioId: negocio.id, telefono: TEL } },
    update: { nombre: NOMBRE, sellosActuales: 3, puntosActuales: 20 },
    create: { negocioId: negocio.id, nombre: NOMBRE, telefono: TEL, sellosActuales: 3, puntosActuales: 20, aceptaNotificaciones: false },
  });
  await prisma.tarjetaClienteSucursal.upsert({
    where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id } },
    update: {}, create: { clienteId: cliente.id, sucursalId: sucursal.id, sellosActuales: 3, puntosActuales: 20 },
  });

  await prisma.premioOtorgado.deleteMany({ where: { negocioId: negocio.id, clienteId: cliente.id } });

  const base = { negocioId: negocio.id, clienteId: cliente.id, sucursalId: sucursal.id };
  const dias = (n) => new Date(Date.now() + n * 86_400_000);
  const premios = [
    { ...base, tipo: 'SELLOS', cantidad: 2, texto: '2 sellos extra', token: `browser-sellos-${Date.now()}`, estado: 'PENDIENTE', expiraEn: dias(7), disparoNombre: 'Compra mayor a $5000' },
    { ...base, tipo: 'LIBRE', cantidad: 0, texto: 'un postre gratis', token: `browser-libre-${Date.now()}`, estado: 'PENDIENTE', disparoNombre: 'Cumpleaños' },
    { ...base, tipo: 'PUNTOS', cantidad: 50, texto: '50 puntos de regalo', token: `browser-puntos-acept-${Date.now()}`, estado: 'ACEPTADO', aceptadoEn: new Date(), campanaNombre: 'Campaña invierno' },
    { ...base, tipo: 'LIBRE', cantidad: 0, texto: 'un café gratis con una porción de torta de chocolate y dos medialunas de manteca', token: `browser-libre-acept-${Date.now()}`, estado: 'ACEPTADO', aceptadoEn: new Date(Date.now() - 86_400_000), campanaNombre: 'Campaña aniversario' },
    { ...base, tipo: 'SELLOS', cantidad: 1, texto: '1 sello de regalo', token: `browser-canjeado-${Date.now()}`, estado: 'CANJEADO', aceptadoEn: new Date(Date.now() - 172_800_000), canjeadoEn: new Date(Date.now() - 86_400_000) },
    // PENDIENTE con `expiraEn` pasado: el listado tiene que devolverlo VENCIDO (computado).
    { ...base, tipo: 'PUNTOS', cantidad: 100, texto: '100 puntos vencidos', token: `browser-vencido-${Date.now()}`, estado: 'PENDIENTE', expiraEn: dias(-2) },
  ];
  for (const p of premios) await prisma.premioOtorgado.create({ data: p });

  const secret = process.env.JWT_CLIENTE_SECRET;
  if (!secret) throw new Error('Falta JWT_CLIENTE_SECRET');
  const token = firmarHS256(
    { sub: cliente.id, negocioId: negocio.id, negocioSlug: negocio.slug, tipo: 'cliente' },
    secret, 30 * 24 * 3600,
  );
  const salida = path.join(os.tmpdir(), 'cookie-mis-premios.txt');
  fs.writeFileSync(salida, `cliente_token=${token}`, 'utf8');

  console.log(`  negocio: ${negocio.slug}`);
  console.log(`  cliente: ${NOMBRE} (${cliente.id})`);
  console.log(`  premios creados: ${premios.length}`);
  console.log(`  cookie -> ${salida} (largo JWT ${token.length}, no se imprime)`);
  console.log(`  url: https://app.clubio.lat/${negocio.slug}/tarjeta`);
}

async function limpiar() {
  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const r = await prisma.cliente.deleteMany({ where: { negocioId: negocio.id, telefono: TEL } });
  console.log(`  clientes de prueba borrados: ${r.count} (los premios caen por cascada)`);
}

/** `sellos <n>`: sube los sellos para que la tarjeta muestre TAMBIEN el bloque del premio del CLUB
 *  (y asi poder verificar el rotulado distinto de los dos conceptos en la misma pantalla). */
async function sellos(n) {
  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const cliente = await prisma.cliente.findFirst({ where: { negocioId: negocio.id, telefono: TEL }, select: { id: true } });
  if (!cliente) throw new Error('corre `crear` primero');
  const sucursal = await prisma.sucursal.findFirst({ where: { negocioId: negocio.id, esPrincipal: true }, select: { id: true } });
  await prisma.cliente.update({ where: { id: cliente.id }, data: { sellosActuales: Number(n) } });
  await prisma.tarjetaClienteSucursal.updateMany({ where: { clienteId: cliente.id, sucursalId: sucursal.id }, data: { sellosActuales: Number(n) } });
  console.log(`  sellos del cliente de prueba: ${n}`);
}

/** `tokens`: imprime los premios de prueba (token + estado + texto). Son datos de prueba, NO
 *  secretos de sesion: el token de un premio es la llave PUBLICA de su pagina de aceptar. */
async function tokens() {
  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const cliente = await prisma.cliente.findFirst({ where: { negocioId: negocio.id, telefono: TEL }, select: { id: true } });
  if (!cliente) throw new Error('corre `crear` primero');
  const filas = await prisma.premioOtorgado.findMany({
    where: { negocioId: negocio.id, clienteId: cliente.id },
    orderBy: { creadoEn: 'asc' },
    select: { token: true, tipo: true, estado: true, texto: true },
  });
  for (const f of filas) console.log(`  ${f.estado.padEnd(9)} ${f.tipo.padEnd(6)} ${f.token}  ${f.texto}`);
}

const cmd = process.argv[2] || 'crear';
(cmd === 'limpiar'
  ? limpiar()
  : cmd === 'sellos'
    ? sellos(process.argv[3])
    : cmd === 'tokens'
      ? tokens()
      : crear())
  .catch((e) => { console.error('  ERROR:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
