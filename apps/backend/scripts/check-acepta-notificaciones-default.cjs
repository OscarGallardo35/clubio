/**
 * Harness: el switch "Acepta notificaciones" nace PRENDIDO.
 *
 *   node apps/backend/scripts/check-acepta-notificaciones-default.cjs
 *   API_URL=https://api.clubio.lat node apps/backend/scripts/check-acepta-notificaciones-default.cjs
 *
 * Crea clientes TEST (via la API real, con la sesion del DUENO) y los borra en el `finally`
 * (DELETE por API = soft delete + hard delete en DB).
 *
 * Nunca imprime secretos.
 */
const path = require('path');
const fs = require('fs');
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

// Firma HS256 sin dependencias (el repo no tiene `jsonwebtoken` a mano en este workspace).
const b64u = (b) => Buffer.from(b).toString('base64url');
const firmarJwt = (payload, secret) => {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${b64u(createHmac('sha256', secret).update(cuerpo).digest())}`;
};

const ROOT = path.resolve(__dirname, '../../..');
function envKey(file, key) {
  const txt = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  }
  return null;
}
for (const f of ['.env', '.env.secrets']) {
  for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

const API = (process.env.API_URL || 'https://api.clubio.lat').replace(/\/$/, '');
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const prisma = new PrismaClient();

let ok = 0, falla = 0;
const chk = (etq, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etq}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etq}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 260) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

async function req(method, p, { body, token, slug = SLUG } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': slug,
    // UA de navegador: la API esta detras de Cloudflare y responde 403 a un UA de script.
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: `https://admin.clubio.lat`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

const RUN = Date.now().toString(36);

async function tokenDuenoDe(slug) {
  const negocio = await prisma.negocio.findFirst({ where: { slug, activo: true }, select: { id: true } });
  if (!negocio) throw new Error(`No existe el negocio ${slug}`);
  const emp = await prisma.empleado.findFirst({
    where: { negocioId: negocio.id, activo: true, eliminadoEn: null, rol: 'DUENO' },
    select: { id: true, rol: true, sucursalId: true, email: true },
  });
  if (!emp) throw new Error(`Sin DUENO en ${slug}`);
  const token = firmarJwt(
    {
      sub: emp.id, tipo: 'empleado', negocioId: negocio.id, negocioSlug: slug,
      rol: 'DUENO', sucursalId: emp.sucursalId, jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.JWT_EMPLEADO_SECRET,
  );
  return { negocioId: negocio.id, token, email: emp.email };
}

async function limpiar(clienteId) {
  if (!clienteId) return;
  await prisma.eventoAuditoria.deleteMany({ where: { clienteId } }).catch(() => undefined);
  await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } }).catch(() => undefined);
  await prisma.visita.deleteMany({ where: { clienteId } }).catch(() => undefined);
  await prisma.cliente.deleteMany({ where: { id: clienteId } }).catch(() => undefined);
}

async function main() {
  console.log(`\n== Acepta notificaciones default :: ${SLUG} :: run ${RUN} :: ${API} ==`);

  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true, nombre: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  // ---------- [0] Cuantos clientes existentes quedarian APAGADOS ----------
  console.log('\n[0] Inventario de clientes con el switch APAGADO (tenant por tenant)');
  for (const slug of ['que-lomitos', 'bar-la-esquina']) {
    const neg = await prisma.negocio.findFirst({ where: { slug }, select: { id: true, nombre: true } });
    if (!neg) { console.log(`  ${slug}: negocio inexistente`); continue; }
    const [total, apagados] = await Promise.all([
      prisma.cliente.count({ where: { negocioId: neg.id, eliminadoEn: null } }),
      prisma.cliente.count({ where: { negocioId: neg.id, eliminadoEn: null, aceptaNotificaciones: false } }),
    ]);
    console.log(`  ${slug} (${neg.nombre}): ${apagados} de ${total} activos con aceptaNotificaciones=false`);
  }

  // ---------- [1] Login REAL del dueno (password del .env, nunca impresa) ----------
  // El email del DUENO se toma de la DB del tenant (`.env.secrets#DUENO_EMAIL` es el del demo
  // `bar-la-esquina`, no sirve para cualquier tenant).
  const duenoEmp = await prisma.empleado.findFirst({
    where: { negocioId, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { email: true },
  });
  const duenoEmail = duenoEmp?.email;
  const duenoPass = envKey('.env', 'DUENO_PASSWORD');
  chk('[1] hay DUENO con email y DUENO_PASSWORD en .env', !!duenoEmail && !!duenoPass, `email=${duenoEmail}`);
  const login = await req('POST', '/api/auth/dueno/login', {
    body: { email: duenoEmail, password: duenoPass, negocioSlug: SLUG },
  });
  const loginOk = [200, 201].includes(login.status) && typeof login.data?.accessToken === 'string';
  chk('[1] login real del dueno -> 201 + accessToken', loginOk, `status=${login.status} ${trunc(login.data?.message ?? Object.keys(login.data ?? {}))}`);
  const token = loginOk ? login.data.accessToken : (await tokenDuenoDe(SLUG)).token;
  if (!loginOk) console.log('  (sigo con un token de dueno firmado con el secreto del repo)');

  const admin = { negocioId, token };

  const DIG = String(Date.now() % 1_000_000).padStart(6, '0');
  const telA = `+54911${DIG}1`;
  const telB = `+54911${DIG}2`;
  const nombreA = `TEST switch ${RUN}`;
  const nombreB = `TEST switch off ${RUN}`;
  let idA = null, idB = null, idC = null;

  try {
    // ---------- [2] ALTA manual SIN el campo -> nace PRENDIDO ----------
    console.log('\n[2] Alta manual (POST /api/clientes) SIN mandar aceptaNotificaciones');
    const r2 = await req('POST', '/api/clientes', { token, body: { nombre: nombreA, telefono: telA } });
    chk('[2] responde 201', r2.status === 201 || r2.status === 200, `status=${r2.status} ${trunc(r2.data)}`);
    idA = r2.data?.id ?? r2.data?.cliente?.id ?? null;
    chk('[2] la respuesta trae aceptaNotificaciones === true', r2.data?.aceptaNotificaciones === true, `valor=${r2.data?.aceptaNotificaciones}`);

    if (idA) {
      const db = await prisma.cliente.findUnique({ where: { id: idA }, select: { aceptaNotificaciones: true } });
      chk('[2] la DB lo confirma (aceptaNotificaciones === true)', db?.aceptaNotificaciones === true, `db=${db?.aceptaNotificaciones}`);

      const g = await req('GET', `/api/clientes/${idA}`, { token });
      chk('[2] GET /api/clientes/:id lo devuelve en true',
        g.status === 200 && g.data?.cliente?.aceptaNotificaciones === true,
        `status=${g.status} valor=${g.data?.cliente?.aceptaNotificaciones}`);

      const l = await req('GET', `/api/clientes?search=${encodeURIComponent(nombreA)}`, { token });
      const enLista = (l.data?.data ?? []).find((c) => c.id === idA);
      chk('[2] el listado (lo que lee el form del admin al EDITAR) tambien lo trae en true',
        !!enLista && enLista.aceptaNotificaciones === true, `valor=${enLista?.aceptaNotificaciones}`);
    }

    // ---------- [3] NO-REGRESION: un cliente apagado no se enciende solo ----------
    console.log('\n[3] NO-REGRESION (backend): alta explicita en false y PATCH de otro campo');
    const r3 = await req('POST', '/api/clientes', { token, body: { nombre: nombreB, telefono: telB, aceptaNotificaciones: false } });
    chk('[3] alta con aceptaNotificaciones:false -> se respeta (queda false)',
      [200, 201].includes(r3.status) && r3.data?.aceptaNotificaciones === false,
      `status=${r3.status} valor=${r3.data?.aceptaNotificaciones}`);
    idB = r3.data?.id ?? null;
    if (idB) {
      const p = await req('PATCH', `/api/clientes/${idB}`, { token, body: { notasInternas: 'patch sin tocar el switch' } });
      chk('[3] PATCH que NO menciona el campo -> 200', p.status === 200, `status=${p.status} ${trunc(p.data?.message)}`);
      const g = await req('GET', `/api/clientes/${idB}`, { token });
      chk('[3] sigue en false despues del PATCH (no lo enciende)',
        g.data?.cliente?.aceptaNotificaciones === false, `valor=${g.data?.cliente?.aceptaNotificaciones}`);
      const l = await req('GET', `/api/clientes?search=${encodeURIComponent(nombreB)}`, { token });
      const enLista = (l.data?.data ?? []).find((c) => c.id === idB);
      chk('[3] el valor que vera el FORM del admin al abrirlo es false (no arranca en true)',
        !!enLista && enLista.aceptaNotificaciones === false, `valor=${enLista?.aceptaNotificaciones}`);
    }
    // ---------- [4] REGISTRO del cliente (PWA cliente) SIN el campo -> nace PRENDIDO ----------
    console.log('\n[4] Registro del cliente (POST /api/auth/cliente/registrar) SIN aceptaNotificaciones');
    const telC = `+54911${DIG}3`;
    const nombreC = `TEST switch reg ${RUN}`;
    const r4 = await req('POST', '/api/auth/cliente/registrar', {
      body: { nombre: nombreC, telefono: telC, negocioSlug: SLUG },
    });
    chk('[4] responde 201', [200, 201].includes(r4.status), `status=${r4.status} ${trunc(r4.data)}`);
    idC = r4.data?.id ?? r4.data?.cliente?.id ?? null;
    if (idC) {
      const db = await prisma.cliente.findUnique({ where: { id: idC }, select: { aceptaNotificaciones: true } });
      chk('[4] la DB lo confirma (aceptaNotificaciones === true)', db?.aceptaNotificaciones === true, `db=${db?.aceptaNotificaciones}`);
    } else {
      chk('[4] el registro devolvio un id', false, trunc(r4.data));
    }
  } finally {
    console.log('\n[limpieza]');
    for (const id of [idA, idB, idC]) {
      if (!id) continue;
      await req('DELETE', `/api/clientes/${id}`, { token }).catch(() => undefined);
      await limpiar(id);
      const queda = await prisma.cliente.count({ where: { id } });
      console.log(`  ${id}: ${queda === 0 ? 'borrado' : `QUEDO (${queda})`}`);
      if (queda) falla++;
    }
  }

  console.log(`\n==== RESULTADO (${SLUG}): ${ok} OK / ${falla} FALLA ====`);
  await prisma.$disconnect();
  if (falla > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('\nABORTADO:', e.message);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
