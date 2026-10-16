/**
 * LATENCIA del camino caliente de la visita, contra un deploy REAL (antes / despues de optimizar).
 *
 *   pnpm --filter @mi-saas/backend test:latencia
 *   API_URL=https://api.clubio.lat OUT=latencia-antes.json pnpm --filter @mi-saas/backend test:latencia
 *
 * Cronometra el `time_total` de:
 *   [1] GET  /api/health
 *   [2] GET  /api/negocios/publico/<TENANT_PUBLICO>
 *   [3] POST /api/visitas/solicitar           (3 corridas, con el estado reseteado antes de cada una)
 *   [4] POST /api/visitas/aprobar/:token      (3 corridas, cada una con su token recien pedido)
 *   [5] GET  /api/visitas/estado/:token       (3 corridas, token vivo)
 *   [6] GET  /api/visitas/mi-tarjeta          (3 corridas, con premios en todos los estados)
 *
 * Crea UN cliente descartable en el tenant (con premios ACEPTADO/CANJEADO/PENDIENTE, que son los
 * que disparan el armado del mecanismo de canje en la tarjeta) y lo BORRA TODO en el `finally`.
 * El archivo de salida (OUT, default: TMPDIR del sistema) trae los ms crudos y los status, para
 * armar la tabla antes/despues.
 *
 * No manda ningun push real: el cliente no tiene suscripcion.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHmac, randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const TENANT_PUBLICO = process.env.TENANT_PUBLICO || 'nonona-lomos';
const CORRIDAS = Number(process.env.CORRIDAS || 3);
const OUT = process.env.OUT || path.join(os.tmpdir(), 'latencia-visitas.json');

const prisma = new PrismaClient();

const b64 = (b) => Buffer.from(b).toString('base64url');
function firmar(payload, secret) {
  const ahora = Math.floor(Date.now() / 1000);
  const c = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ ...payload, jti: randomUUID(), iat: ahora, exp: ahora + 3600 }),
  )}`;
  return `${c}.${b64(createHmac('sha256', secret).update(c).digest())}`;
}

async function req(method, p, { body, token, slug } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': slug || SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(API + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  const ms = Math.round(performance.now() - t0);
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data, ms };
}

/** Cronometra `fn` N veces seguidas (caliente) y devuelve los ms + el status de la ultima. */
async function medir(nombre, fn, corridas = CORRIDAS) {
  const ms = [];
  let ultimo = null;
  for (let i = 0; i < corridas; i++) {
    ultimo = await fn(i);
    ms.push(ultimo.ms);
  }
  const orden = [...ms].sort((a, b) => a - b);
  const mediana = orden[Math.floor(orden.length / 2)];
  // El MINIMO es el mejor estimador del costo real cuando el ruido de la red solo SUMA: se reporta
  // junto con la mediana porque la primera corrida suele pagar el camino frio (pool/edge).
  const minimo = orden[0];
  console.log(
    `  ${nombre.padEnd(46)} ${ms.map((m) => `${m}ms`).join('  ')}   min=${minimo}ms mediana=${mediana}ms  status=${ultimo.status}`,
  );
  if (ultimo.status >= 400) console.log(`       !! respuesta: ${String(JSON.stringify(ultimo.data)).slice(0, 300)}`);
  return { nombre, ms, min: minimo, mediana, status: ultimo.status };
}

(async () => {
  const resultados = [];
  const negocio = await prisma.negocio.findFirst({
    where: { slug: SLUG, activo: true },
    select: { id: true, nombre: true },
  });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  if (!empleado) throw new Error('Sin empleado DUENO/ENCARGADO');
  const sucursal = await prisma.sucursal.findFirst({
    where: { negocioId, esPrincipal: true, activa: true },
    select: { id: true },
  });
  const cfgClub = await prisma.configuracionClub.findUnique({
    where: { negocioId },
    select: { modoFidelizacion: true, limiteVisitasPorDia: true, horasMinimasEntreVisitas: true },
  });

  const staffToken = firmar(
    { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
    process.env.JWT_EMPLEADO_SECRET,
  );

  const RUN = Date.now().toString(36);
  const tel = `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
  let clienteId = null;

  console.log(`\n== LATENCIA visitas :: ${API} :: tenant ${SLUG} :: run ${RUN} ==`);
  console.log(`   config: modo=${cfgClub?.modoFidelizacion} limiteDia=${cfgClub?.limiteVisitasPorDia} horasMin=${cfgClub?.horasMinimasEntreVisitas}\n`);

  /** Estado inicial IDENTICO antes de cada corrida (limite diario / horas minimas / saldos). */
  const resetCliente = async () => {
    await prisma.disparoPushLog.deleteMany({ where: { clienteId } }).catch(() => undefined);
    await prisma.premioOtorgado.deleteMany({ where: { clienteId } });
    await prisma.visita.deleteMany({ where: { clienteId } });
    await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
    await prisma.cliente.update({
      where: { id: clienteId },
      data: { sellosActuales: 0, puntosActuales: 0, totalVisitas: 0, ultimaVisita: null, premiosCanjeados: 0 },
    });
  };

  try {
    const cliente = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST latencia ${RUN}`, telefono: tel, aceptaNotificaciones: false },
      select: { id: true },
    });
    clienteId = cliente.id;
    await prisma.tarjetaClienteSucursal.upsert({
      where: { clienteId_sucursalId: { clienteId, sucursalId: sucursal.id } },
      update: { sellosActuales: 0, puntosActuales: 0, totalVisitas: 0 },
      create: { clienteId, sucursalId: sucursal.id },
    });
    const cliToken = firmar(
      { sub: clienteId, tipo: 'cliente', negocioId, negocioSlug: SLUG },
      process.env.JWT_CLIENTE_SECRET,
    );

    // ---- [1] y [2]: endpoints de referencia (sin estado) --------------------
    await req('GET', '/api/health'); // warmup del edge/conexion
    resultados.push(await medir('GET /api/health', () => req('GET', '/api/health')));
    resultados.push(
      await medir(`GET /api/negocios/publico/${TENANT_PUBLICO}`, () =>
        req('GET', `/api/negocios/publico/${TENANT_PUBLICO}`),
      ),
    );

    // ---- [3] POST /visitas/solicitar ---------------------------------------
    resultados.push(
      await medir('POST /visitas/solicitar', async () => {
        await resetCliente();
        return req('POST', '/api/visitas/solicitar', {
          token: cliToken,
          body: { origen: 'qr_club', sucursalId: sucursal.id },
        });
      }),
    );

    // ---- [4] POST /visitas/aprobar/:token ----------------------------------
    resultados.push(
      await medir('POST /visitas/aprobar/:token', async () => {
        await resetCliente();
        const sol = await req('POST', '/api/visitas/solicitar', {
          token: cliToken,
          body: { origen: 'qr_club', sucursalId: sucursal.id },
        });
        if (!sol.data?.token) throw new Error(`solicitar no devolvio token: ${JSON.stringify(sol.data).slice(0, 200)}`);
        return req('POST', `/api/visitas/aprobar/${sol.data.token}`, {
          token: staffToken,
          body: { origen: 'staff', montoConsumido: 2000 },
        });
      }),
    );

    // ---- [5] GET /visitas/estado/:token -----------------------------------
    resultados.push(
      await medir('GET /visitas/estado/:token', async () => {
        await resetCliente();
        const sol = await req('POST', '/api/visitas/solicitar', {
          token: cliToken,
          body: { origen: 'qr_club', sucursalId: sucursal.id },
        });
        return req('GET', `/api/visitas/estado/${sol.data.token}`, { token: cliToken });
      }),
    );

    // ---- premios en TODOS los estados (los ACEPTADO/CANJEADO son los que arman el canje) --
    await resetCliente();
    const mk = (data) =>
      prisma.premioOtorgado.create({ data: { negocioId, clienteId, sucursalId: sucursal.id, ...data } });
    for (const [i, estado] of ['ACEPTADO', 'ACEPTADO', 'ACEPTADO', 'CANJEADO', 'PENDIENTE', 'PENDIENTE'].entries()) {
      await mk({
        tipo: i % 2 ? 'SELLOS' : 'PUNTOS',
        cantidad: 2,
        texto: `premio latencia ${i} ${RUN}`,
        token: `test-lat-${RUN}-${i}`,
        estado,
        aceptadoEn: estado === 'PENDIENTE' ? null : new Date(),
        canjeadoEn: estado === 'CANJEADO' ? new Date() : null,
      });
    }

    // ---- [6] GET /visitas/mi-tarjeta --------------------------------------
    await req('GET', '/api/visitas/mi-tarjeta', { token: cliToken }); // warmup (token de verificacion lazy)
    resultados.push(await medir('GET /visitas/mi-tarjeta', () => req('GET', '/api/visitas/mi-tarjeta', { token: cliToken })));

    fs.writeFileSync(
      OUT,
      JSON.stringify({ api: API, slug: SLUG, run: RUN, corridas: CORRIDAS, resultados, fecha: new Date().toISOString() }, null, 2),
    );
    console.log(`\n  -> ${OUT}`);
  } finally {
    try {
      if (clienteId) {
        await prisma.disparoPushLog.deleteMany({ where: { clienteId } }).catch(() => undefined);
        await prisma.premioOtorgado.deleteMany({ where: { clienteId } });
        await prisma.visita.deleteMany({ where: { clienteId } });
        await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
        await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } });
        await prisma.eventoAuditoria.deleteMany({ where: { clienteId } });
        await prisma.cliente.delete({ where: { id: clienteId } });
        console.log(`  limpieza OK (cliente ${clienteId} y sus filas borradas)`);
      }
    } catch (e) {
      console.error(`  !! LIMPIEZA INCOMPLETA: ${e.message}  (clienteId=${clienteId})`);
    }
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(`FALLO: ${e.stack || e.message}`);
  process.exitCode = 1;
});
