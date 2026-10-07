/**
 * Un PIN no puede repetirse DENTRO del negocio (fix `EmpleadosService.exigirPinLibre`).
 *
 * Vigila la debilidad del `@@unique([negocioId, pinHash])`: bcrypt usa salt aleatorio, asi que
 * el mismo PIN produce hashes distintos y el indice nunca colisiona. El login recorre los
 * empleados del negocio y se queda con el PRIMER `bcrypt.compare` que da true, asi que con dos
 * PIN iguales la identidad (y el ROL) del que entra depende del orden.
 *
 * NO depende del login de dueno (que pide 2FA): firma un JWT con el MISMO secreto y el mismo
 * payload que emite `loginDueno`, y lo valida `StaffGuard` (que acepta `tipo: 'dueno'`).
 *
 *   pnpm --filter backend test:pin                                   (localhost:3000)
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:pin
 *
 * Necesita `JWT_DUENO_SECRET` y `PIN_ENCARGADO` (los carga el script npm de .env/.env.secrets).
 * Crea un empleado de prueba y lo borra (soft delete por API + hard delete por Prisma) en un
 * `finally`, aunque falle una asercion.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const SECRET = process.env.JWT_DUENO_SECRET;
const PIN_YA_USADO = process.env.PIN_ENCARGADO; // el de Maria Encargada
const PIN_LIBRE = process.env.PIN_LIBRE || '918273';

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

(async () => {
  if (!SECRET || !PIN_YA_USADO) {
    console.log('FALTAN JWT_DUENO_SECRET y/o PIN_ENCARGADO en el entorno.');
    process.exit(2);
  }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const negocio = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { id: true, nombre: true, sucursalId: true },
  });
  if (!dueno?.sucursalId) {
    console.log('No encontre un DUENO activo con sucursal para el tenant.');
    process.exit(2);
  }
  console.log(`dueno: ${dueno.nombre} (${dueno.id})\n`);

  const token = firmarDueno({
    sub: dueno.id, negocioId: negocio.id, negocioSlug: SLUG,
    rol: 'DUENO', tipo: 'dueno', jti: randomUUID(),
  }, SECRET);

  let creado = null;
  try {
    const crear = await req('POST', '/api/empleados', {
      nombre: `Harness PIN ${Date.now()}`, rol: 'MESERO',
      sucursalId: dueno.sucursalId, pin: '9999',
    }, token);
    chk('empleado de prueba creado (POST /empleados)', crear.status === 201,
      `status=${crear.status} ${JSON.stringify(crear.data?.message ?? '')}`);
    creado = crear.data?.id;

    if (creado) {
      const dup = await req('PATCH', `/api/empleados/${creado}/reset-pin`, { pin: PIN_YA_USADO }, token);
      chk('PIN que ya usa otro del negocio -> 409', dup.status === 409,
        `status=${dup.status} message=${JSON.stringify(dup.data?.message ?? '')}`);
      chk('el mensaje dice por que', typeof dup.data?.message === 'string' && /ya lo usa/.test(dup.data.message));

      const libre = await req('PATCH', `/api/empleados/${creado}/reset-pin`, { pin: PIN_LIBRE }, token);
      chk('PIN libre -> 200', libre.status === 200,
        `status=${libre.status} ${JSON.stringify(libre.data?.message ?? '')}`);
    }
  } finally {
    if (creado) {
      const soft = await req('DELETE', `/api/empleados/${creado}`, undefined, token);
      const borrado = await prisma.empleado.delete({ where: { id: creado } })
        .then(() => 'ok').catch((e) => 'fallo: ' + String(e.message).slice(0, 60));
      console.log(`\n  limpieza: soft delete=${soft.status} | hard delete=${borrado}`);
    }
    await prisma.$disconnect();
  }

  console.log(`\nTOTAL: ${fallos === 0 ? 'OK' : fallos + ' FALLA(S)'}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log('ERROR:', e && e.message ? e.message : e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
