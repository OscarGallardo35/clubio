/**
 * Permiso por empleado para administrar la carta completa (`Empleado.puedeEditarCarta`).
 *
 *   pnpm --filter @mi-saas/backend test:permiso-carta
 *   API_URL=https://api.clubio.lat pnpm --filter @mi-saas/backend test:permiso-carta
 *
 * Que cubre:
 *   1. Dos empleados de PRUEBA (rol MESERO, uno CON el permiso y otro SIN) creados y BORRADOS al
 *      final. No se toca ningun dato de un cliente real: los pocos items que se crean viven en una
 *      categoria propia del harness y se borran al final.
 *   2. El que TIENE el permiso: listar, crear, reordenar, cambiar disponibilidad, editar, eliminar
 *      y FIRMAR UNA SUBIDA (la foto del paquete completo).
 *   3. El que NO lo tiene: 403 en TODOS, firma incluida.
 *   4. El interruptor aplica SIN re-login: se prende y se apaga el flag en la DB y se re-mide con el
 *      MISMO token (lo re-lee `StaffGuard` en cada request).
 *   5. No-regresion del DUENO: todo le sigue funcionando igual.
 *   6. El baseline no se movio: un ENCARGADO sin permiso sigue editando la carta (200) y sigue sin
 *      poder firmar subidas (403, que es como estaba `POST /media/firmar-subida`).
 *   7. Aislamiento entre negocios: un empleado de A no puede tocar la carta de B (404) ni firmar
 *      subidas para B (la firma cuelga SIEMPRE del negocio del token).
 *   8. Que la excepcion NO se abra en el resto del producto: con el permiso de carta prendido, los
 *      endpoints de empleados/sucursales/configuracion siguen bloqueados (es la razon de aplicar el
 *      decorador endpoint por endpoint y no dentro del `RolesGuard`).
 *
 * El estado vuelve EXACTAMENTE a como estaba: se borran los empleados y los items de prueba y se
 * restaura el contador de uso de `items_carta` (que `POST /carta` incrementa y que el DELETE no baja,
 * a proposito).
 *
 * Necesita `JWT_DUENO_SECRET` / `JWT_EMPLEADO_SECRET` (firma los tokens a mano, como
 * check-cloudinary) y `DATABASE_URL`.
 */
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG_A = process.env.TENANT_SLUG || 'que-lomitos';
const SLUG_B = process.env.TENANT_SLUG_B || 'bar-la-esquina';
const SECRET_DUENO = process.env.JWT_DUENO_SECRET;
const SECRET_EMPLEADO = process.env.JWT_EMPLEADO_SECRET;

const prisma = new PrismaClient();
const SFX = randomUUID().slice(0, 8);
/** Categoria propia: identifica TODO lo que deja este harness y nada mas. */
const CAT = `ZZ PermisoCarta ${SFX}`;

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
  return cond;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function firmar(payload, secret) {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${b64u(createHmac('sha256', secret).update(cuerpo).digest())}`;
}

async function req(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null } catch { data = texto; }
  return { status: res.status, data };
}

/** Los 7 endpoints del paquete: 6 de carta + la firma de la subida. */
async function opsCarta(cookie, itemId, etiquetaItem = 'harness') {
  return {
    listar: await req('GET', '/api/carta/admin', { cookie }),
    crear: await req('POST', '/api/carta', {
      cookie,
      body: { categoria: CAT, nombre: `${CAT} ${etiquetaItem}`, precio: 123.45, descripcion: 'harness' },
    }),
    reordenar: await req('POST', '/api/carta/reordenar', { cookie, body: { items: [{ id: itemId, orden: 0 }] } }),
    disponibilidad: await req('PATCH', `/api/carta/${itemId}/disponibilidad`, { cookie, body: { disponible: true } }),
    editar: await req('PATCH', `/api/carta/${itemId}`, { cookie, body: { descripcion: 'harness' } }),
    eliminar: await req('DELETE', `/api/carta/${itemId}`, { cookie }),
    firmar: await req('POST', '/api/media/firmar-subida', { cookie, body: { tipo: 'carta' } }),
  };
}

/** `ok` para las 7: crear/eliminar responden 200/201; la firma puede ser 503 si el backend no tiene Cloudinary. */
const OK_FIRMA = [200, 201, 503];
function chkTodasOk(ops, etiqueta) {
  chk(`${etiqueta}: GET /carta/admin -> 2xx`, [200, 201].includes(ops.listar.status), `status=${ops.listar.status}`);
  chk(`${etiqueta}: POST /carta (crear) -> 2xx`, [200, 201].includes(ops.crear.status), `status=${ops.crear.status}`);
  chk(`${etiqueta}: POST /carta/reordenar -> 2xx`, [200, 201].includes(ops.reordenar.status), `status=${ops.reordenar.status}`);
  chk(`${etiqueta}: PATCH /carta/:id/disponibilidad -> 2xx`, [200, 201].includes(ops.disponibilidad.status), `status=${ops.disponibilidad.status}`);
  chk(`${etiqueta}: PATCH /carta/:id -> 2xx`, [200, 201].includes(ops.editar.status), `status=${ops.editar.status}`);
  chk(`${etiqueta}: DELETE /carta/:id -> 2xx`, [200, 201].includes(ops.eliminar.status), `status=${ops.eliminar.status}`);
  chk(
    `${etiqueta}: POST /media/firmar-subida -> no 403`,
    OK_FIRMA.includes(ops.firmar.status),
    `status=${ops.firmar.status}${ops.firmar.status === 503 ? ' (backend sin Cloudinary: el guard igual lo dejo pasar)' : ''}`,
  );
}
function chkTodas403(ops, etiqueta) {
  for (const [nombre, r] of Object.entries(ops)) {
    chk(`${etiqueta}: ${nombre} -> 403`, r.status === 403, `status=${r.status}`);
  }
}

/** Contador de `items_carta` del periodo (sucursalId null): se snapshot y se restaura. */
function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
async function leerContadorItems(negocioId) {
  const filas = await prisma.$queryRawUnsafe(
    `SELECT id, cantidad, estado, excedente FROM "UsoMensual"
     WHERE "negocioId" = $1 AND "sucursalId" IS NULL AND recurso = 'ITEMS_CARTA' AND periodo = $2`,
    negocioId,
    periodoActual(),
  );
  return filas[0] ?? null;
}

(async () => {
  if (!SECRET_DUENO || !SECRET_EMPLEADO) {
    console.log('FALTAN JWT_DUENO_SECRET / JWT_EMPLEADO_SECRET en el entorno.');
    process.exit(2);
  }
  console.log(`API: ${API}\nTenant A: ${SLUG_A}   Tenant B (aislamiento): ${SLUG_B}\nMarca de corrida: ${SFX}\n`);

  const negA = await prisma.negocio.findUnique({ where: { slug: SLUG_A }, select: { id: true, plan: true } });
  const negB = await prisma.negocio.findUnique({ where: { slug: SLUG_B }, select: { id: true } });
  if (!negA || !negB) { console.log('No encontre los dos negocios del seed.'); process.exit(2); }
  const sucA = await prisma.sucursal.findFirst({ where: { negocioId: negA.id }, select: { id: true, nombre: true } });
  const duenoA = await prisma.empleado.findFirst({
    where: { negocioId: negA.id, rol: 'DUENO', activo: true, eliminadoEn: null },
    select: { id: true, sucursalId: true },
  });
  const itemB = await prisma.itemCarta.findFirst({ where: { negocioId: negB.id }, select: { id: true } });
  if (!sucA || !duenoA || !itemB) { console.log('Falta sucursal/dueno en A o algun item en B.'); process.exit(2); }

  // Snapshot ANTES de tocar nada: el contador de items_carta del periodo.
  const contadorAntes = await leerContadorItems(negA.id);

  const creados = [];
  const empleadosCreados = [];

  try {
    // ---------------------------------------------------------------- 1) dos empleados de prueba
    console.log('--- 1) Empleados de prueba (rol MESERO)');
    const base = { negocioId: negA.id, sucursalId: sucA.id, rol: 'MESERO' };
    const empSi = await prisma.empleado.create({
      data: { ...base, nombre: `ZZ PermisoCarta SI ${SFX}`, puedeEditarCarta: true },
      select: { id: true, puedeEditarCarta: true },
    });
    const empNo = await prisma.empleado.create({
      data: { ...base, nombre: `ZZ PermisoCarta NO ${SFX}`, puedeEditarCarta: false },
      select: { id: true, puedeEditarCarta: true },
    });
    empleadosCreados.push(empSi.id, empNo.id);
    chk('el de prueba CON permiso quedo en true', empSi.puedeEditarCarta === true);
    chk('el de prueba SIN permiso quedo en false (default del switch)', empNo.puedeEditarCarta === false);

    const tokenEmpleado = (empId) => firmar(
      { sub: empId, negocioId: negA.id, negocioSlug: SLUG_A, rol: 'MESERO', sucursalId: sucA.id, tipo: 'empleado', jti: randomUUID() },
      SECRET_EMPLEADO,
    );
    const cookieSi = `empleado_token=${tokenEmpleado(empSi.id)}`;
    const cookieNo = `empleado_token=${tokenEmpleado(empNo.id)}`;
    const cookieDueno = `dueno_token=${firmar(
      { sub: duenoA.id, negocioId: negA.id, negocioSlug: SLUG_A, rol: 'DUENO', sucursalId: duenoA.sucursalId, tipo: 'dueno', jti: randomUUID() },
      SECRET_DUENO,
    )}`;

    // ---------------------------------------------------------------- 2) propagacion a /me
    console.log('\n--- 2) Propagacion a GET /auth/empleado/me');
    const meSi = await req('GET', '/api/auth/empleado/me', { cookie: cookieSi });
    const meNo = await req('GET', '/api/auth/empleado/me', { cookie: cookieNo });
    chk('me (con permiso) -> 200', meSi.status === 200, `status=${meSi.status}`);
    chk('me (con permiso) trae empleado.puedeEditarCarta=true', meSi.data?.empleado?.puedeEditarCarta === true,
      `valor=${String(meSi.data?.empleado?.puedeEditarCarta)}`);
    chk('me (sin permiso) trae empleado.puedeEditarCarta=false', meNo.data?.empleado?.puedeEditarCarta === false,
      `valor=${String(meNo.data?.empleado?.puedeEditarCarta)}`);

    // ---------------------------------------------------------------- 3) el que TIENE el permiso
    console.log('\n--- 3) Empleado CON permiso (rol MESERO): paquete completo');
    // El primer item de la corrida lo crea el: crear es parte del paquete.
    const primera = await req('POST', '/api/carta', {
      cookie: cookieSi,
      body: { categoria: CAT, nombre: `${CAT} base`, precio: 100, descripcion: 'harness' },
    });
    chk('POST /carta (crear) -> 2xx', [200, 201].includes(primera.status), `status=${primera.status}`);
    const itemId = primera.data?.id;
    if (itemId) creados.push(itemId);
    chk('la respuesta del crear trae el id', typeof itemId === 'string' && itemId.length > 0);

    const opsSi = await opsCarta(cookieSi, itemId, 'segundo');
    chkTodasOk(opsSi, 'CON permiso');
    const itemSegundo = opsSi.crear.data?.id;
    if (itemSegundo) creados.push(itemSegundo);
    chk('el item creado cae en la categoria del harness', opsSi.crear.data?.categoria === CAT,
      `categoria=${String(opsSi.crear.data?.categoria)}`);
    chk('la disponibilidad cambio de verdad (disponible=true)', opsSi.disponibilidad.data?.disponible === true,
      `disponible=${String(opsSi.disponibilidad.data?.disponible)}`);
    chk('el editar cambio la descripcion de verdad', opsSi.editar.data?.descripcion === 'harness',
      `descripcion=${String(opsSi.editar.data?.descripcion)}`);
    chk('la firma de la subida cuelga del negocio del token',
      opsSi.firmar.data?.folder === `clubio/${negA.id}/carta`, `folder=${String(opsSi.firmar.data?.folder)}`);
    chk('la firma no filtra un secreto (no viene api_secret)',
      !('api_secret' in (opsSi.firmar.data ?? {})), `claves=${Object.keys(opsSi.firmar.data ?? {}).join(',')}`);

    // ---------------------------------------------------------------- 4) el que NO lo tiene
    console.log('\n--- 4) Empleado SIN permiso (rol MESERO): 403 en todo');
    const opsNo = await opsCarta(cookieNo, itemId, 'no-deberia-crearse');
    chkTodas403(opsNo, 'SIN permiso');
    const enCategoria = await prisma.itemCarta.count({ where: { negocioId: negA.id, categoria: CAT } });
    chk('el SIN permiso no pudo crear nada (la categoria sigue con 2 items)', enCategoria === 2, `items=${enCategoria}`);

    // ---------------------------------------------------------------- 5) el switch aplica sin re-login
    console.log('\n--- 5) Prender/apagar aplica SIN re-login (mismo token)');
    await prisma.empleado.update({ where: { id: empNo.id }, data: { puedeEditarCarta: true } });
    const prender = await req('GET', '/api/carta/admin', { cookie: cookieNo });
    chk('con el flag PRENDIDO en la DB, el mismo token ahora lista -> 200', prender.status === 200, `status=${prender.status}`);
    await prisma.empleado.update({ where: { id: empNo.id }, data: { puedeEditarCarta: false } });
    const apagar = await req('GET', '/api/carta/admin', { cookie: cookieNo });
    chk('con el flag APAGADO, el mismo token vuelve a -> 403', apagar.status === 403, `status=${apagar.status}`);

    // ---------------------------------------------------------------- 6) control del DUENO
    console.log('\n--- 6) Control de no-regresion: el DUENO');
    const opsDueno = await opsCarta(cookieDueno, itemId, 'del-dueno');
    chkTodasOk(opsDueno, 'DUENO');
    const itemDueno = opsDueno.crear.data?.id;
    if (itemDueno) creados.push(itemDueno);

    // ---------------------------------------------------------------- 7) baseline intacto (ENCARGADO)
    console.log('\n--- 7) Baseline del ENCARGADO sin permiso (no se movio)');
    const encargado = await prisma.empleado.findFirst({
      where: { negocioId: negA.id, rol: 'ENCARGADO', activo: true, eliminadoEn: null },
      select: { id: true, sucursalId: true },
    });
    if (encargado) {
      const cookieEnc = `empleado_token=${firmar(
        { sub: encargado.id, negocioId: negA.id, negocioSlug: SLUG_A, rol: 'ENCARGADO', sucursalId: encargado.sucursalId, tipo: 'empleado', jti: randomUUID() },
        SECRET_EMPLEADO,
      )}`;
      const listaEnc = await req('GET', '/api/carta/admin', { cookie: cookieEnc });
      const firmaEnc = await req('POST', '/api/media/firmar-subida', { cookie: cookieEnc, body: { tipo: 'carta' } });
      chk('ENCARGADO sin permiso sigue listando la carta -> 200', listaEnc.status === 200, `status=${listaEnc.status}`);
      chk('ENCARGADO sin permiso sigue SIN firmar subidas -> 403', firmaEnc.status === 403, `status=${firmaEnc.status}`);
    } else {
      console.log('  (skip) no hay ENCARGADO activo en el tenant A');
    }

    // ---------------------------------------------------------------- 8) aislamiento A vs B
    console.log('\n--- 8) Aislamiento: empleado de A contra la carta de B');
    const isoEditar = await req('PATCH', `/api/carta/${itemB.id}`, { cookie: cookieSi, body: { descripcion: 'no' } });
    const isoDisp = await req('PATCH', `/api/carta/${itemB.id}/disponibilidad`, { cookie: cookieSi, body: { disponible: true } });
    const isoBorrar = await req('DELETE', `/api/carta/${itemB.id}`, { cookie: cookieSi });
    const isoReordenar = await req('POST', '/api/carta/reordenar', { cookie: cookieSi, body: { items: [{ id: itemB.id, orden: 0 }] } });
    chk('PATCH de un item de B -> 404', isoEditar.status === 404, `status=${isoEditar.status}`);
    chk('disponibilidad de un item de B -> 404', isoDisp.status === 404, `status=${isoDisp.status}`);
    chk('DELETE de un item de B -> 404', isoBorrar.status === 404, `status=${isoBorrar.status}`);
    chk('reordenar con un item de B -> 404', isoReordenar.status === 404, `status=${isoReordenar.status}`);
    const itemBSigue = await prisma.itemCarta.findUnique({ where: { id: itemB.id }, select: { disponible: true, descripcion: true } });
    chk('el item de B quedo intacto en la DB', itemBSigue !== null, JSON.stringify(itemBSigue));

    const firmaAjena = await req('POST', '/api/media/firmar-subida', { cookie: cookieSi, body: { tipo: 'carta', negocioId: negB.id } });
    chk('firmar pidiendo el negocio B NO da una firma para B',
      firmaAjena.data?.folder !== `clubio/${negB.id}/carta`,
      `status=${firmaAjena.status} folder=${String(firmaAjena.data?.folder ?? '(sin folder)')}`);
    chk('el folder valido sigue siendo el del token', opsSi.firmar.data?.folder === `clubio/${negA.id}/carta`);

    const idsB = new Set((await prisma.itemCarta.findMany({ where: { negocioId: negB.id }, select: { id: true } })).map((i) => i.id));
    const itemsVistos = (opsSi.listar.data?.categorias ?? []).flatMap((g) => g.items).map((i) => i.id);
    chk('el listado de A no incluye NINGUN item de B', itemsVistos.every((id) => !idsB.has(id)),
      `items=${itemsVistos.length} deB=${itemsVistos.filter((id) => idsB.has(id)).length}`);

    // ---------------------------------------------------------------- 9) la excepcion NO se abre en el resto
    console.log('\n--- 9) El permiso NO abre otros endpoints del producto (la razon de no tocar RolesGuard)');
    const otros = {
      'GET /empleados': await req('GET', '/api/empleados', { cookie: cookieSi }),
      [`PATCH /empleados/:id`]: await req('PATCH', `/api/empleados/${empNo.id}`, { cookie: cookieSi, body: { nombre: 'no' } }),
      'GET /sucursales': await req('GET', '/api/sucursales', { cookie: cookieSi }),
      'GET /configuracion': await req('GET', '/api/configuracion', { cookie: cookieSi }),
    };
    for (const [nombre, r] of Object.entries(otros)) {
      chk(`con el permiso de carta, ${nombre} sigue bloqueado (no 2xx)`, !(r.status >= 200 && r.status < 300), `status=${r.status}`);
    }
  } finally {
    // ---------------------------------------------------------------- limpieza
    console.log('\n--- Limpieza');
    try {
      const borradosItems = await prisma.itemCarta.deleteMany({ where: { negocioId: negA.id, categoria: CAT } });
      console.log(`  items de prueba borrados: ${borradosItems.count} (ids conocidos: ${creados.length})`);
      const restantes = await prisma.itemCarta.count({ where: { negocioId: negA.id, categoria: CAT } });
      console.log(`  items de prueba que quedan: ${restantes}`);
      const borradosEmp = await prisma.empleado.deleteMany({ where: { id: { in: empleadosCreados } } });
      console.log(`  empleados de prueba borrados: ${borradosEmp.count}/${empleadosCreados.length}`);
      const empRestantes = await prisma.empleado.count({
        where: { nombre: { startsWith: 'ZZ PermisoCarta' } },
      });
      console.log(`  empleados "ZZ PermisoCarta" que quedan en la DB: ${empRestantes}`);
      const permisoRestante = await prisma.empleado.count({ where: { puedeEditarCarta: true } });
      console.log(`  empleados con puedeEditarCarta=true (esperado 0): ${permisoRestante}`);

      // El contador de items_carta lo infla POST /carta y el DELETE no lo baja: se restaura.
      if (contadorAntes) {
        await prisma.$executeRawUnsafe(
          `UPDATE "UsoMensual" SET cantidad = $1, estado = $2::"EstadoUso", excedente = $3, "actualizadoEn" = NOW()
           WHERE id = $4`,
          contadorAntes.cantidad,
          contadorAntes.estado,
          contadorAntes.excedente,
          contadorAntes.id,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "UsoMensual" WHERE "negocioId" = $1 AND "sucursalId" IS NULL AND recurso = 'ITEMS_CARTA' AND periodo = $2`,
          negA.id,
          periodoActual(),
        );
      }
      const contadorDespues = await leerContadorItems(negA.id);
      const okContador = contadorAntes
        ? contadorDespues?.cantidad === contadorAntes.cantidad
        : contadorDespues === null;
      console.log(`  contador items_carta: antes=${contadorAntes ? contadorAntes.cantidad : 'sin fila'} despues=${contadorDespues ? contadorDespues.cantidad : 'sin fila'} (restaurado: ${okContador})`);
    } catch (e) {
      console.log(`  ERROR en la limpieza: ${e.message}`);
      fallos += 1;
    }
    await prisma.$disconnect();
    console.log(fallos === 0 ? '\nTOTAL OK' : `\nTOTAL FALLAS: ${fallos}`);
    process.exit(fallos === 0 ? 0 : 1);
  }
})().catch(async (e) => {
  console.log('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
