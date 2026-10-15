/**
 * Verificacion end-to-end del PERFILADO PROGRESIVO (fase 1) DEL LADO DEL BACKEND.
 *
 *   pnpm --filter backend test:perfil-cliente
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:perfil-cliente
 *
 * Corre contra PROD (API + DB) y cubre:
 *  [1] `PATCH /api/auth/cliente/perfil` guarda fecha de nacimiento y genero, y REGISTRA el
 *      consentimiento (`consentimientoPerfilEn` + `consentimientoPerfilVer`).
 *  [2] `GET /api/auth/cliente/me` devuelve los 4 campos nuevos del perfilado.
 *  [3] Validacion EN EL SERVIDOR: fecha invalida -> 400, fecha FUTURA -> 400, edad < 13 -> 400,
 *      genero fuera del enum -> 400. (No alcanza con validar en el input de la PWA.)
 *  [4] `{ rechazar: true }` marca `perfiladoRechazado` (nunca mas se le pregunta) pero NO
 *      bloquea un guardado posterior: el rechazo es del PEDIDO, no del cliente.
 *  [5] BORRAR: `fechaNacimiento: null` la deja en null y `DELETE /perfil` borra fecha + genero
 *      + el registro de consentimiento.
 *  [6] El dueno tambien carga/corrige el perfil (`PATCH /clientes/:id`) con la MISMA validacion,
 *      y `GET /clientes` / `GET /clientes/:id` devuelven `fechaNacimiento` y `genero`.
 *  [7] El umbral `perfilDesdeVisita` viaja en la config publica (`GET /api/negocios/publico/:slug`),
 *      default 3, y el dueno puede bajarlo.
 *
 * Crea un cliente TEST y lo BORRA en el `finally` (mas las filas de auditoria que deje). Los
 * tokens se FIRMAN con los secretos del repo (los logins reales piden password/2FA, que un
 * harness no puede hacer). No se imprime ningun secreto.
 */
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const API = (process.env.API_URL || 'https://api.clubio.lat').replace(/\/$/, '');
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const prisma = new PrismaClient();

let ok = 0;
let falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 220) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);
/** `YYYY-MM-DD` de hace N años (para fabricar fechas de edad conocida). */
const haceAnios = (n) => {
  const d = new Date();
  const iso = new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate()));
  return iso.toISOString().slice(0, 10);
};

async function req(method, p, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
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
const DIG = String(Date.now() % 1_000_000).padStart(6, '0');

async function main() {
  console.log(`\n== Perfilado progresivo (cliente) :: ${SLUG} :: run ${RUN} :: ${API} ==`);

  const negocio = await prisma.negocio.findFirst({
    where: { slug: SLUG, activo: true }, select: { id: true, nombre: true },
  });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  // Token de DUENO/ENCARGADO (para /clientes) y de DUENO (para /configuracion).
  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  if (!empleado) throw new Error('Sin empleado DUENO/ENCARGADO');
  const secretEmp = process.env.JWT_EMPLEADO_SECRET;
  const secretDueno = process.env.JWT_DUENO_SECRET;
  const secretCli = process.env.JWT_CLIENTE_SECRET;
  if (!secretEmp || !secretCli || !secretDueno) {
    throw new Error('Faltan JWT_EMPLEADO_SECRET / JWT_CLIENTE_SECRET / JWT_DUENO_SECRET');
  }
  const tokenStaff = jwt.sign(
    { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
    secretEmp, { expiresIn: '1h' },
  );
  const tokenDueno = jwt.sign(
    { sub: empleado.id, tipo: 'dueno', negocioId, negocioSlug: SLUG, rol: 'DUENO', sucursalId: null },
    secretDueno, { expiresIn: '1h' },
  );

  // ---- recursos a limpiar ----
  let clienteId = null;
  let perfilPrevio = null;
  let configTocada = false;

  try {
    // ======================================================================
    console.log('\n[setup] Cliente de prueba (creado en la DB, borrado en el finally)');
    const tel = `+54911${DIG}${Math.floor(Math.random() * 9)}`;
    const cliente = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST perfilado ${RUN}`, telefono: tel },
    });
    clienteId = cliente.id;
    const tokenCli = jwt.sign(
      { sub: cliente.id, tipo: 'cliente', negocioId, negocioSlug: SLUG },
      secretCli, { expiresIn: '1h' },
    );
    console.log(`    cliente: ${cliente.nombre} (${cliente.id})`);
    chk(
      '[setup] el cliente nace SIN perfil (fecha y genero en null, sin rechazo)',
      cliente.fechaNacimiento === null && cliente.genero === null && cliente.perfiladoRechazado === false,
      `fecha=${cliente.fechaNacimiento} genero=${cliente.genero} rechazado=${cliente.perfiladoRechazado}`,
    );

    // ======================================================================
    console.log('\n[1] PATCH /auth/cliente/perfil guarda fecha + genero y registra el consentimiento');
    const r1 = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: '1990-05-14', genero: 'FEMENINO' },
    });
    chk('[1] responde 200', r1.status === 200, `status=${r1.status} ${trunc(r1.data)}`);
    const p1 = r1.data?.perfil ?? {};
    chk('[1] devuelve la fecha guardada',
      String(p1.fechaNacimiento ?? '').slice(0, 10) === '1990-05-14', `fecha=${p1.fechaNacimiento}`);
    chk('[1] devuelve el genero guardado', p1.genero === 'FEMENINO', `genero=${p1.genero}`);
    chk('[1] registra el consentimiento (fecha + version del texto)',
      !!p1.consentimientoPerfilEn && p1.consentimientoPerfilVer === 'v1-2026-10',
      `en=${p1.consentimientoPerfilEn} ver=${p1.consentimientoPerfilVer}`);
    const db1 = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { fechaNacimiento: true, genero: true, consentimientoPerfilEn: true, consentimientoPerfilVer: true },
    });
    chk('[1] la DB quedo igual (no es solo la respuesta)',
      String(db1.fechaNacimiento?.toISOString() ?? '').slice(0, 10) === '1990-05-14' &&
        db1.genero === 'FEMENINO' && !!db1.consentimientoPerfilEn,
      trunc(db1));

    // ======================================================================
    console.log('\n[2] GET /auth/cliente/me devuelve los campos del perfilado');
    const r2 = await req('GET', '/api/auth/cliente/me', { token: tokenCli });
    chk('[2] responde 200', r2.status === 200, `status=${r2.status} ${trunc(r2.data)}`);
    const c2 = r2.data?.cliente ?? {};
    chk('[2] trae fechaNacimiento / genero / perfiladoRechazado / perfiladoOmitidoEn',
      'fechaNacimiento' in c2 && 'genero' in c2 && 'perfiladoRechazado' in c2 && 'perfiladoOmitidoEn' in c2,
      Object.keys(c2).join(','));
    chk('[2] la fecha del me() es la guardada',
      String(c2.fechaNacimiento ?? '').slice(0, 10) === '1990-05-14', `fecha=${c2.fechaNacimiento}`);
    chk('[2] el genero del me() es el guardado', c2.genero === 'FEMENINO', `genero=${c2.genero}`);
    chk('[2] perfiladoOmitidoEn arranca en null', c2.perfiladoOmitidoEn === null, `${c2.perfiladoOmitidoEn}`);

    // ======================================================================
    console.log('\n[3] Validacion EN EL SERVIDOR');
    const r3a = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: haceAnios(-1) },
    });
    chk('[3] fecha FUTURA -> 400', r3a.status === 400, `status=${r3a.status} ${trunc(r3a.data?.message)}`);

    const r3b = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: haceAnios(10) },
    });
    chk('[3] edad < 13 (10 años) -> 400', r3b.status === 400, `status=${r3b.status} ${trunc(r3b.data?.message)}`);

    const r3c = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: '2026-02-30' },
    });
    chk('[3] fecha INEXISTENTE (2026-02-30) -> 400', r3c.status === 400, `status=${r3c.status} ${trunc(r3c.data?.message)}`);

    const r3d = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: haceAnios(130) },
    });
    chk('[3] mas de 100 años atras -> 400', r3d.status === 400, `status=${r3d.status} ${trunc(r3d.data?.message)}`);

    const r3e = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { genero: 'MARCIANO' },
    });
    chk('[3] genero fuera del enum -> 400', r3e.status === 400, `status=${r3e.status} ${trunc(r3e.data?.message)}`);

    const r3f = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { genero: 'PREFIERO_NO_DECIR' },
    });
    chk('[3] PREFIERO_NO_DECIR es un valor VALIDO del enum -> 200',
      r3f.status === 200 && r3f.data?.perfil?.genero === 'PREFIERO_NO_DECIR',
      `status=${r3f.status} genero=${r3f.data?.perfil?.genero}`);

    const r3g = await req('PATCH', '/api/auth/cliente/perfil', {
      token: 'token-invalido', body: { fechaNacimiento: '1990-05-14' },
    });
    chk('[3] sin sesion valida -> 401', r3g.status === 401, `status=${r3g.status}`);
    const antesDeTodo = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { fechaNacimiento: true } });
    chk('[3] ninguna de las invalidas toco la fecha guardada',
      String(antesDeTodo.fechaNacimiento?.toISOString() ?? '').slice(0, 10) === '1990-05-14',
      `${antesDeTodo.fechaNacimiento}`);

    // ======================================================================
    console.log('\n[4] rechazar:true marca el rechazo y NO bloquea un guardado posterior');
    const r4a = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { rechazar: true },
    });
    chk('[4] responde 200', r4a.status === 200, `status=${r4a.status} ${trunc(r4a.data)}`);
    chk('[4] perfiladoRechazado queda en true', r4a.data?.perfil?.perfiladoRechazado === true, trunc(r4a.data?.perfil));
    const db4 = await prisma.cliente.findUnique({
      where: { id: clienteId }, select: { perfiladoRechazado: true, genero: true },
    });
    chk('[4] el rechazo NO borra lo ya guardado (el genero sobrevive)',
      db4.perfiladoRechazado === true && db4.genero === 'PREFIERO_NO_DECIR', trunc(db4));

    const r4b = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { genero: 'MASCULINO' },
    });
    chk('[4] un guardado DESPUES del rechazo sigue permitido -> 200',
      r4b.status === 200 && r4b.data?.perfil?.genero === 'MASCULINO',
      `status=${r4b.status} genero=${r4b.data?.perfil?.genero}`);

    // ======================================================================
    console.log('\n[5] Omitir y BORRAR los datos de perfil');
    const r5a = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { omitido: true },
    });
    chk('[5] omitido:true sella perfiladoOmitidoEn',
      r5a.status === 200 && !!r5a.data?.perfil?.perfiladoOmitidoEn,
      `status=${r5a.status} omitidoEn=${r5a.data?.perfil?.perfiladoOmitidoEn}`);

    const r5b = await req('PATCH', '/api/auth/cliente/perfil', {
      token: tokenCli, body: { fechaNacimiento: null },
    });
    chk('[5] fechaNacimiento:null la deja en null (y no toca el genero)',
      r5b.status === 200 && r5b.data?.perfil?.fechaNacimiento === null && r5b.data?.perfil?.genero === 'MASCULINO',
      trunc(r5b.data?.perfil));

    const r5c = await req('DELETE', '/api/auth/cliente/perfil', { token: tokenCli });
    chk('[5] DELETE /perfil responde 200', r5c.status === 200, `status=${r5c.status} ${trunc(r5c.data)}`);
    chk('[5] borra fecha, genero y el consentimiento',
      r5c.data?.perfil?.fechaNacimiento === null && r5c.data?.perfil?.genero === null &&
        r5c.data?.perfil?.consentimientoPerfilEn === null && r5c.data?.perfil?.consentimientoPerfilVer === null,
      trunc(r5c.data?.perfil));
    const db5 = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { fechaNacimiento: true, genero: true, consentimientoPerfilEn: true, perfiladoRechazado: true },
    });
    chk('[5] la DB confirma el borrado (y el rechazo NO se revierte)',
      db5.fechaNacimiento === null && db5.genero === null && db5.consentimientoPerfilEn === null &&
        db5.perfiladoRechazado === true,
      trunc(db5));

    // ======================================================================
    console.log('\n[6] El DUENO carga/corrige el perfil desde el panel (/clientes)');
    const r6a = await req('PATCH', `/api/clientes/${clienteId}`, {
      token: tokenStaff, body: { fechaNacimiento: '1985-03-02', genero: 'NO_BINARIO' },
    });
    chk('[6] PATCH /clientes/:id con fecha + genero -> 200', r6a.status === 200, `status=${r6a.status} ${trunc(r6a.data)}`);
    chk('[6] la respuesta trae los dos campos',
      String(r6a.data?.fechaNacimiento ?? '').slice(0, 10) === '1985-03-02' && r6a.data?.genero === 'NO_BINARIO',
      `fecha=${r6a.data?.fechaNacimiento} genero=${r6a.data?.genero}`);

    const r6b = await req('GET', `/api/clientes/${clienteId}`, { token: tokenStaff });
    chk('[6] GET /clientes/:id (detalle) devuelve fecha y genero',
      r6b.status === 200 &&
        String(r6b.data?.cliente?.fechaNacimiento ?? '').slice(0, 10) === '1985-03-02' &&
        r6b.data?.cliente?.genero === 'NO_BINARIO',
      `status=${r6b.status} fecha=${r6b.data?.cliente?.fechaNacimiento} genero=${r6b.data?.cliente?.genero}`);

    const r6c = await req('GET', `/api/clientes?search=${encodeURIComponent(`TEST perfilado ${RUN}`)}`, { token: tokenStaff });
    const enLista = (r6c.data?.data ?? []).find((c) => c.id === clienteId);
    chk('[6] GET /clientes (listado) devuelve fecha y genero',
      r6c.status === 200 && !!enLista && enLista.genero === 'NO_BINARIO' &&
        String(enLista.fechaNacimiento ?? '').slice(0, 10) === '1985-03-02',
      `status=${r6c.status} fecha=${enLista?.fechaNacimiento} genero=${enLista?.genero}`);

    const r6d = await req('PATCH', `/api/clientes/${clienteId}`, {
      token: tokenStaff, body: { fechaNacimiento: haceAnios(10) },
    });
    chk('[6] el dueno usa la MISMA validacion: edad < 13 -> 400', r6d.status === 400, `status=${r6d.status} ${trunc(r6d.data?.message)}`);

    const r6e = await req('PATCH', `/api/clientes/${clienteId}`, {
      token: tokenStaff, body: { genero: 'MARCIANO' },
    });
    chk('[6] el dueno usa el MISMO enum: genero invalido -> 400', r6e.status === 400, `status=${r6e.status} ${trunc(r6e.data?.message)}`);

    // ======================================================================
    console.log('\n[7] El UMBRAL perfilDesdeVisita viaja en la config publica');
    const r7a = await req('GET', `/api/negocios/publico/${SLUG}`);
    chk('[7] GET /negocios/publico/:slug responde 200', r7a.status === 200, `status=${r7a.status} ${trunc(r7a.data?.message)}`);
    chk('[7] expone perfilDesdeVisita (default 3)',
      typeof r7a.data?.perfilDesdeVisita === 'number', `perfilDesdeVisita=${r7a.data?.perfilDesdeVisita}`);
    chk('[7] tambien viaja dentro de `configuracion`',
      r7a.data?.configuracion?.perfilDesdeVisita === r7a.data?.perfilDesdeVisita,
      `configuracion=${r7a.data?.configuracion?.perfilDesdeVisita} top=${r7a.data?.perfilDesdeVisita}`);

    perfilPrevio = await prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { perfilDesdeVisita: true },
    });
    const r7b = await req('PATCH', '/api/configuracion', {
      token: tokenDueno, body: { perfilDesdeVisita: 2 },
    });
    configTocada = r7b.status === 200;
    chk('[7] el dueno puede BAJARLO a 2 (PATCH /configuracion) -> 200', r7b.status === 200, `status=${r7b.status} ${trunc(r7b.data?.message)}`);
    const r7c = await req('GET', `/api/negocios/publico/${SLUG}`);
    chk('[7] la config publica ya refleja 2', r7c.data?.perfilDesdeVisita === 2, `perfilDesdeVisita=${r7c.data?.perfilDesdeVisita}`);
    const r7d = await req('PATCH', '/api/configuracion', {
      token: tokenDueno, body: { perfilDesdeVisita: 0 },
    });
    chk('[7] 0 es invalido (min 1) -> 400', r7d.status === 400, `status=${r7d.status} ${trunc(r7d.data?.message)}`);
  } finally {
    console.log('\n[limpieza]');
    // El umbral del club se restaura SIEMPRE (aunque el bloque [7] haya fallado).
    if (configTocada || perfilPrevio) {
      await prisma.configuracionClub
        .update({ where: { negocioId }, data: { perfilDesdeVisita: perfilPrevio?.perfilDesdeVisita ?? 3 } })
        .catch(() => undefined);
      const restaurado = await prisma.configuracionClub.findUnique({
        where: { negocioId }, select: { perfilDesdeVisita: true },
      });
      console.log(`  perfilDesdeVisita restaurado a ${restaurado?.perfilDesdeVisita}`);
      if (restaurado?.perfilDesdeVisita !== (perfilPrevio?.perfilDesdeVisita ?? 3)) {
        falla++;
        console.log('  FALLA no se pudo restaurar el umbral del club');
      }
    }
    if (clienteId) {
      const borradosAudit = await prisma.eventoAuditoria
        .deleteMany({ where: { clienteId, accion: 'cliente.actualizado' } })
        .catch(() => ({ count: 0 }));
      await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } }).catch(() => undefined);
      await prisma.visita.deleteMany({ where: { clienteId } }).catch(() => undefined);
      await prisma.cliente.deleteMany({ where: { id: clienteId } }).catch(() => undefined);
      console.log(`  cliente de prueba borrado (auditoria: ${borradosAudit.count} filas)`);
    }
    const sobrantes = clienteId ? await prisma.cliente.count({ where: { id: clienteId } }) : 0;
    if (sobrantes) { falla++; console.log(`  FALLA quedo ${sobrantes} cliente de prueba`); }
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
