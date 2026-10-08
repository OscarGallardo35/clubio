/**
 * Harness de la configuracion del club vista por el ADMIN (modo de fidelizacion + programa de puntos).
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:config-admin
 *
 * Que prueba:
 *   1. `GET /configuracion` devuelve los 3 campos del programa de puntos (no solo la columna en la
 *      base: la respuesta que consume la pantalla).
 *   2. `PATCH` con modo HIBRIDO + tasa + umbral + texto  -> `GET` los devuelve cambiados.
 *   3. `PATCH` a SOLO_VISITAS -> `GET` lo refleja, y los campos de puntos quedan como estaban
 *      (el modo no los usa: no se pisan).
 *
 * RESTAURA la config original al final (pase lo que pase). El token de dueño se firma con
 * `JWT_DUENO_SECRET`: el login real pide password + 2FA, que un harness no puede hacer.
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

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

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

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true } });
  const dueno = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, rol: 'DUENO', activo: true, eliminadoEn: null }, select: { id: true },
  });
  const token = firmarDueno(dueno.id, negocio.id);
  const original = await prisma.configuracionClub.findUnique({
    where: { negocioId: negocio.id },
    select: { modoFidelizacion: true, puntosPorMil: true, premioPorPuntos: true, premioTextoPuntos: true },
  });

  try {
    // ---- 1) GET devuelve los 3 campos ----
    console.log('[1] GET /configuracion trae el programa de puntos');
    let g = await req('GET', '/api/configuracion', undefined, token);
    chk('GET responde 200', g.status === 200, `status=${g.status}`);
    chk('trae puntosPorMil', 'puntosPorMil' in (g.data ?? {}), JSON.stringify(g.data?.puntosPorMil));
    chk('trae premioPorPuntos', 'premioPorPuntos' in (g.data ?? {}), JSON.stringify(g.data?.premioPorPuntos));
    chk('trae premioTextoPuntos', 'premioTextoPuntos' in (g.data ?? {}), JSON.stringify(g.data?.premioTextoPuntos));

    // ---- 2) HIBRIDO + tasa + umbral + texto ----
    console.log('\n[2] PATCH modo HIBRIDO + puntosPorMil 7 + premioPorPuntos 150 + texto');
    const r = await req('PATCH', '/api/configuracion', {
      modoFidelizacion: 'HIBRIDO', puntosPorMil: 7, premioPorPuntos: 150,
      premioTextoPuntos: 'Flan casero de prueba',
    }, token);
    chk('PATCH responde 200', r.status === 200, `status=${r.status} ${JSON.stringify(r.data?.message ?? '')}`);
    g = await req('GET', '/api/configuracion', undefined, token);
    chk('el modo quedo HIBRIDO', g.data?.modoFidelizacion === 'HIBRIDO', String(g.data?.modoFidelizacion));
    chk('la tasa quedo en 7', g.data?.puntosPorMil === 7, String(g.data?.puntosPorMil));
    chk('el umbral quedo en 150', g.data?.premioPorPuntos === 150, String(g.data?.premioPorPuntos));
    chk('el texto quedo guardado', g.data?.premioTextoPuntos === 'Flan casero de prueba', String(g.data?.premioTextoPuntos));

    // ---- 3) volver a SOLO_VISITAS sin tocar los campos de puntos ----
    console.log('\n[3] PATCH a SOLO_VISITAS (los campos de puntos no se mandan)');
    const r2 = await req('PATCH', '/api/configuracion', { modoFidelizacion: 'SOLO_VISITAS' }, token);
    chk('PATCH responde 200', r2.status === 200, `status=${r2.status}`);
    g = await req('GET', '/api/configuracion', undefined, token);
    chk('el modo volvio a SOLO_VISITAS', g.data?.modoFidelizacion === 'SOLO_VISITAS', String(g.data?.modoFidelizacion));
    chk('la tasa sigue en 7 (no se piso)', g.data?.puntosPorMil === 7, String(g.data?.puntosPorMil));

    // ---- 4) validacion: una tasa absurda se rechaza ----
    console.log('\n[4] control: puntosPorMil fuera de rango');
    const r3 = await req('PATCH', '/api/configuracion', { puntosPorMil: 99999 }, token);
    chk('rechaza con 400', r3.status === 400, `status=${r3.status}`);
  } finally {
    if (original) {
      await prisma.configuracionClub.update({
        where: { negocioId: negocio.id },
        data: {
          modoFidelizacion: original.modoFidelizacion,
          puntosPorMil: original.puntosPorMil,
          premioPorPuntos: original.premioPorPuntos,
          premioTextoPuntos: original.premioTextoPuntos,
        },
      }).catch(() => undefined);
    }
    console.log('\ncleanup: config restaurada');
    console.log(fallos === 0 ? '\nTOTAL OK\n' : `\nTOTAL CON ${fallos} FALLA(S)\n`);
    await prisma.$disconnect();
    process.exit(fallos === 0 ? 0 : 1);
  }
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
