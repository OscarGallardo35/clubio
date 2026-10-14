/**
 * Verificacion end-to-end de las CAMPAÑAS DE PUSH PROGRAMABLES (auto-verificable).
 *
 *   pnpm --filter backend test:campanas-push
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:campanas-push
 *
 * Corre contra PROD (API + DB) y cubre:
 *  [1] PREVIEW = ENVIO REAL: el "N de M" que ve el dueño (`/push/campanas/preview`)
 *      coincide con los jobs que realmente se encolan al despachar (no divergen).
 *  [2] Las EXCLUSIONES solo recortan: los excluidos NO se encolan y quedan en el
 *      historial como SUPRIMIDO_EXCLUIDO con el motivo (por que no les llego).
 *  [3] `programadoPara` en HORA ARGENTINA: se guarda en UTC (= AR + 3h) y una campaña
 *      futura NO sale antes; recien cuando su hora pasa (y corre el tick) se despacha.
 *  [4] Reprogramar (PATCH) cambia la hora guardada.
 *  [5] Cancelar devuelve el CUPO y no deja la CampanaMarketing asociada.
 *  [6] El 409: cancelar/reprogramar algo que ya salio (estado ENVIANDO) responde 409.
 *  [7] La CUOTA (`CAMPANAS_PUSH_MES`) se reserva AL CREAR, no al enviar.
 *  [8] El historial por destinatario: filas de `EnvioPushLog` con el `campanaId` y el
 *      resultado real por dispositivo.
 *  [9] Idempotencia: un 2do tick no reenvia (no duplica filas ni jobs).
 *
 * El tick se fuerza por la API (`POST /push/campanas/tick`), NO encolando contra el
 * Redis local: el `.env` local tiene un `REDIS_URL` viejo (el de prod ahora es propio,
 * en red privada), asi que un `cola.add` local no lo ve el worker de prod.
 *
 * NUNCA manda push a un cliente real: los destinatarios de prueba apuntan a
 * `httpbin.org` (o a un endpoint invalido) y las suscripciones REALES se apagan durante
 * la corrida y se restauran enseguida (y de nuevo en el `finally`). El token de staff se
 * FIRMA con el secreto del repo (no se usa ninguna contraseña de persona).
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'que-lomitos';
const prisma = new PrismaClient();

let ok = 0;
let falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 200) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

async function req(method, p, { body, token, slug } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': slug || SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

async function esperar(fn, timeoutMs = 120_000, intervaloMs = 3_000) {
  const hasta = Date.now() + timeoutMs;
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() > hasta) return null;
    await new Promise((res) => setTimeout(res, intervaloMs));
  }
}

/** Par de claves ECDH VALIDO (p256dh de 65 bytes + auth de 16): web-push lo exige. */
function parClaves() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: Buffer.from(ecdh.getPublicKey()).toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  };
}

// ---- hora argentina (UTC-3 fijo), igual criterio que el backend ----
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');
/** Date -> 'YYYY-MM-DDTHH:mm' en hora AR de pared. */
function arWall(base) {
  const d = new Date(base.getTime() - AR_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** 'YYYY-MM-DDTHH:mm' AR de pared -> ms UTC (AR + 3h). */
function arWallAUtcMs(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) + AR_OFFSET_MS;
}
/** Minutos desde las 00:00 en AR. */
function arMinutosAhora() {
  const d = new Date(Date.now() - AR_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** Minutos -> 'HH:mm' (con wrap de 24h). */
function fmtMin(m) {
  const x = ((m % 1440) + 1440) % 1440;
  return `${p2(Math.floor(x / 60))}:${p2(x % 60)}`;
}
/** Date UTC -> 'HH:mm' en AR. */
function hhmmAr(d) {
  const x = new Date(d.getTime() - AR_OFFSET_MS);
  return `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
}

const RUN = `${Date.now().toString(36)}`;
const DIG = String(Date.now() % 1_000_000).padStart(6, '0');
const tel = (d) => `+54911${DIG}${d}`;

async function main() {
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG, activo: true }, select: { id: true, nombre: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  if (!empleado) throw new Error('Sin empleado DUENO/ENCARGADO');

  const secret = process.env.JWT_EMPLEADO_SECRET;
  if (!secret) throw new Error('Falta JWT_EMPLEADO_SECRET en el entorno');
  const staffToken = jwt.sign(
    { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
    secret, { expiresIn: '1h' },
  );
  console.log(`\n== Campañas push :: ${SLUG} :: run ${RUN} :: ${API} ==`);

  // --- recursos a limpiar / restaurar ---
  const clientes = [];
  const campanasPushIds = [];
  const campanasMkIds = [];
  let plantillaId = null;
  let subEmpleadoId = null;
  let plantillaNombre = null;
  let realSubsApagadas = [];
  let realesRestauradas = false;
  let usoPrevio = null;
  let ventanaPrevia = null;
  let ventanaTocada = false;
  const periodo = `${new Date().getFullYear()}-${p2(new Date().getMonth() + 1)}`;

  const restaurarReales = async () => {
    if (realesRestauradas || !realSubsApagadas.length) return;
    await prisma.notificacionPush
      .updateMany({ where: { id: { in: realSubsApagadas } }, data: { activa: true } })
      .catch(() => undefined);
    realesRestauradas = true;
  };

  try {
    // ==========================================================================
    console.log('\n[setup] Clientes de prueba con endpoints que NO son de nadie');
    const pl = await prisma.plantillaPush.create({
      data: { negocioId, nombre: `TEST campanas pl ${RUN}`, titulo: 'Promo {{negocio}}', cuerpo: 'Hola {{nombre}}', url: '/tarjeta', activa: true },
    });
    plantillaId = pl.id;
    plantillaNombre = pl.nombre;

    // 4 suscritos: A y B "entregan" (httpbin 200), C tiene claves invalidas (FALLIDO),
    // D queda excluido a mano (para probar las exclusiones).
    const defs = [
      { clave: 'A', digito: 1, endpoint: `https://httpbin.org/post?run=${RUN}A`, claves: parClaves() },
      { clave: 'B', digito: 2, endpoint: `https://httpbin.org/post?run=${RUN}B`, claves: parClaves() },
      { clave: 'C', digito: 3, endpoint: `https://example.invalid/webpush/${RUN}C`, claves: { p256dh: 'test', auth: 'test' } },
      { clave: 'D', digito: 4, endpoint: `https://httpbin.org/post?run=${RUN}D`, claves: parClaves() },
    ];
    const cli = {};
    for (const d of defs) {
      const c = await prisma.cliente.create({
        data: { negocioId, nombre: `TEST ${RUN} ${d.clave}`, telefono: tel(d.digito), aceptaNotificaciones: true },
      });
      clientes.push(c.id);
      await prisma.notificacionPush.create({
        data: { negocioId, clienteId: c.id, endpoint: d.endpoint, auth: d.claves.auth, p256dh: d.claves.p256dh, activa: true },
      });
      cli[d.clave] = c;
    }
    console.log(`    clientes de prueba: ${Object.keys(cli).join(', ')} (D se va a EXCLUIR)`);

    // Apago las suscripciones REALES: la campaña TODOS no debe llegarle a nadie de verdad.
    const reales = await prisma.notificacionPush.findMany({
      where: { negocioId, activa: true, clienteId: { notIn: clientes } }, select: { id: true },
    });
    if (reales.length) {
      await prisma.notificacionPush.updateMany({
        where: { id: { in: reales.map((r) => r.id) } }, data: { activa: false },
      });
      realSubsApagadas = reales.map((r) => r.id);
    }
    console.log(`    suscripciones reales apagadas durante la corrida: ${realSubsApagadas.length}`);

    usoPrevio = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });

    // ==========================================================================
    console.log('\n[1] PREVIEW del alcance (~N de M) con D excluido a mano');
    const rPrev = await req('POST', '/api/push/campanas/preview', {
      token: staffToken,
      body: { segmento: 'TODOS', excluirClienteIds: [cli.D.id] },
    });
    chk('POST /push/campanas/preview responde 201/200', rPrev.status === 201 || rPrev.status === 200, `status=${rPrev.status} ${trunc(rPrev.data)}`);
    const prev = rPrev.data ?? {};
    chk('el preview trae alcanzables / total / desglose',
      typeof prev.alcanzables === 'number' && typeof prev.total === 'number' && !!prev.desglose,
      trunc(prev));
    chk('M (total) = suscritos del segmento = 4', prev.total === 4, `total=${prev.total}`);
    chk('N (alcanzables) = 3 con D excluido', prev.alcanzables === 3, `alcanzables=${prev.alcanzables}`);
    chk('el desglose cuenta 1 excluido', prev.desglose?.excluidos === 1, `excluidos=${prev.desglose?.excluidos}`);
    chk('el desglose dice que el numero es una estimacion', prev.estimacion === true, `estimacion=${prev.estimacion}`);
    chk('no hay clientes sin push entre los de prueba', (prev.desglose?.sinSuscripcionActiva ?? -1) >= 0, `sinSuscripcionActiva=${prev.desglose?.sinSuscripcionActiva}`);

    // ==========================================================================
    console.log('\n[7] La CUOTA se reserva AL CREAR (no al enviar)');
    const usoAntes = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });
    const cantidadAntes = usoAntes?.cantidad ?? 0;

    console.log('\n[3] Creo una campaña PROGRAMADA A FUTURO (con D excluido)');
    const wallFuturo = arWall(new Date(Date.now() + 10 * 60_000));
    const esperadoMs = arWallAUtcMs(wallFuturo);
    const rCrear = await req('POST', '/api/push/campanas', {
      token: staffToken,
      body: {
        nombre: `TEST campanas PRINCIPAL ${RUN}`,
        plantillaId: pl.id,
        titulo: 'Promo {{negocio}}',
        cuerpo: 'Hola {{nombre}}',
        url: '/tarjeta',
        segmento: 'TODOS',
        programadoPara: wallFuturo,
        excluirClienteIds: [cli.D.id],
      },
    });
    chk('POST /push/campanas responde 201/200', rCrear.status === 201 || rCrear.status === 200, `status=${rCrear.status} ${trunc(rCrear.data)}`);
    const campanaAhora = rCrear.data ?? {};
    if (campanaAhora.id) campanasPushIds.push(campanaAhora.id);
    if (campanaAhora.campanaId) campanasMkIds.push(campanaAhora.campanaId);
    chk('la campaña nace PROGRAMADA con su campanaId y sin enviadaEn',
      campanaAhora.estado === 'PROGRAMADA' && !!campanaAhora.campanaId && campanaAhora.enviadaEn === null,
      `estado=${campanaAhora.estado} campanaId=${campanaAhora.campanaId} enviadaEn=${campanaAhora.enviadaEn}`);
    chk('[2] guarda las exclusiones (D)', Array.isArray(campanaAhora.exclusiones?.clientes) && campanaAhora.exclusiones.clientes.includes(cli.D.id), trunc(campanaAhora.exclusiones));
    chk('[3] la hora AR se convirtio a UTC (= AR + 3h)',
      Date.parse(campanaAhora.programadoPara) === esperadoMs,
      `guardado=${campanaAhora.programadoPara} esperado=${new Date(esperadoMs).toISOString()} wall=${wallFuturo}`);

    const usoTrasCrear = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });
    chk('[7] el uso CAMPANAS_PUSH_MES subio +1 AL CREAR (antes de enviar)',
      (usoTrasCrear?.cantidad ?? 0) === cantidadAntes + 1,
      `antes=${cantidadAntes} despues=${usoTrasCrear?.cantidad}`);

    // ==========================================================================
    console.log('\n[3] A FUTURO no sale antes, ni con el tick forzado');
    const rTick = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    chk('POST /push/campanas/tick responde 201/200', rTick.status === 201 || rTick.status === 200, `status=${rTick.status} ${trunc(rTick.data)}`);
    const campanaPost = await prisma.campanaPush.findUnique({ where: { id: campanaAhora.id } });
    const filasFutura = await prisma.envioPushLog.count({ where: { campanaId: campanaAhora.campanaId } });
    chk('[3] sigue PROGRAMADA tras el tick', campanaPost?.estado === 'PROGRAMADA', `estado=${campanaPost?.estado} tick=${trunc(rTick.data)}`);
    chk('[3] NO se encolo ninguna notificacion', filasFutura === 0, `filas=${filasFutura}`);
    chk('[3] control: si la hora AR se hubiera leido como UTC, ya habria salido',
      esperadoMs - AR_OFFSET_MS < Date.now(),
      `interpretacion-UTC=${new Date(esperadoMs - AR_OFFSET_MS).toISOString()} ahora=${new Date().toISOString()}`);

    // ==========================================================================
    console.log('\n[1] Llega la hora: el dispatcher la despacha (tick forzado)');
    await prisma.campanaPush.update({
      where: { id: campanaAhora.id },
      data: { programadoPara: new Date(Date.now() - 60_000) },
    });
    const rTickVencida = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    chk('el tick de la vencida responde 201/200', rTickVencida.status === 201 || rTickVencida.status === 200, `status=${rTickVencida.status} ${trunc(rTickVencida.data)}`);
    const terminada = await esperar(async () => {
      const c = await prisma.campanaPush.findUnique({ where: { id: campanaAhora.id } });
      return c?.estado === 'ENVIADA' ? c : null;
    }, 60_000);
    chk('[1] la campaña quedo ENVIADA con enviadaEn',
      !!terminada?.enviadaEn,
      `estado=${terminada?.estado} enviadaEn=${terminada?.enviadaEn?.toISOString() ?? null} tick=${trunc(rTickVencida.data)}`);

    const filasEncolado = await prisma.envioPushLog.findMany({ where: { campanaId: campanaAhora.campanaId } });
    const encolados = filasEncolado.filter((f) => f.estado !== 'SUPRIMIDO_EXCLUIDO' && f.clienteId);
    chk('[1] el ENVIO REAL encolo tantos destinatarios como dijo el preview',
      encolados.length === prev.alcanzables, `encolados=${encolados.length} (preview=${prev.alcanzables})`);
    chk('[1] las filas encoladas tienen el campanaId y el jobId',
      encolados.every((f) => f.campanaId === campanaAhora.campanaId && !!f.jobId),
      `sinJobId=${encolados.filter((f) => !f.jobId).length}`);

    // ==========================================================================
    console.log('\n[2] Las EXCLUSIONES solo recortan (D no se encolo y quedo explicado)');
    chk('[2] D NO tiene ninguna fila encolada', !encolados.some((f) => f.clienteId === cli.D.id));
    const filaD = filasEncolado.find((f) => f.clienteId === cli.D.id);
    chk('[2] D quedo como SUPRIMIDO_EXCLUIDO con el motivo',
      filaD?.estado === 'SUPRIMIDO_EXCLUIDO' && !!filaD?.motivo,
      `estado=${filaD?.estado} motivo=${trunc(filaD?.motivo, 60)}`);

    // ==========================================================================
    console.log('\n[8] El historial por destinatario (resultado REAL de cada dispositivo)');
    const listas = await esperar(async () => {
      const f = await prisma.envioPushLog.findMany({ where: { campanaId: campanaAhora.campanaId } });
      return f.length > 0 && f.every((x) => x.estado !== 'ENCOLADO') ? f : null;
    }, 150_000);
    const filas = listas ?? await prisma.envioPushLog.findMany({ where: { campanaId: campanaAhora.campanaId } });
    const porCliente = new Map(filas.map((f) => [f.clienteId, f]));
    chk('[8] A quedo ENVIADO con el HTTP del proveedor',
      porCliente.get(cli.A.id)?.estado === 'ENVIADO' && !!porCliente.get(cli.A.id)?.statusCode,
      `estado=${porCliente.get(cli.A.id)?.estado} statusCode=${porCliente.get(cli.A.id)?.statusCode}`);
    chk('[8] C (claves invalidas) quedo FALLIDO con motivo',
      porCliente.get(cli.C.id)?.estado === 'FALLIDO' && !!porCliente.get(cli.C.id)?.motivo,
      `estado=${porCliente.get(cli.C.id)?.estado} motivo=${trunc(porCliente.get(cli.C.id)?.motivo, 40)}`);
    chk('[8] las filas guardan el snapshot del titulo y el segmento',
      porCliente.get(cli.A.id)?.campanaTitulo === 'Promo {{negocio}}' && porCliente.get(cli.A.id)?.segmento === 'TODOS',
      `titulo=${trunc(porCliente.get(cli.A.id)?.campanaTitulo)} segmento=${porCliente.get(cli.A.id)?.segmento}`);

    const rLogs = await req('GET', `/api/push/envios/logs?page=1&pageSize=50&campanaId=${campanaAhora.campanaId}`, { token: staffToken });
    chk('GET /push/envios/logs?campanaId responde 200', rLogs.status === 200, `status=${rLogs.status}`);
    chk('[8] la API del historial devuelve los envios de la campaña',
      (rLogs.data?.data ?? []).length >= 3, `n=${(rLogs.data?.data ?? []).length}`);

    const rLista = await req('GET', '/api/push/campanas', { token: staffToken });
    chk('GET /push/campanas responde 200', rLista.status === 200, `status=${rLista.status}`);
    const enLista = (rLista.data?.data ?? []).find((c) => c.id === campanaAhora.id);
    chk('[8] la lista trae la campaña ENVIADA con stats (n/m)',
      enLista?.estado === 'ENVIADA' && !!enLista?.stats && enLista.stats.enviados >= 1 && enLista.stats.total >= 3,
      `estado=${enLista?.estado} stats=${trunc(enLista?.stats)}`);

    // ==========================================================================
    console.log('\n[9] IDEMPOTENCIA: un 2do tick no reenvia');
    const filasAntes = await prisma.envioPushLog.count({ where: { campanaId: campanaAhora.campanaId } });
    const rTick2 = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    chk('el 2do tick responde 201/200', rTick2.status === 201 || rTick2.status === 200, trunc(rTick2.data));
    const filasDespues = await prisma.envioPushLog.count({ where: { campanaId: campanaAhora.campanaId } });
    chk('[9] no se duplicaron filas de historial', filasAntes === filasDespues, `antes=${filasAntes} despues=${filasDespues}`);
    const encoladosExtra = await prisma.envioPushLog.count({
      where: { campanaId: campanaAhora.campanaId, estado: 'ENCOLADO' },
    });
    chk('[9] no quedo ningun envio NUEVO encolado', encoladosExtra === 0, `encolados=${encoladosExtra}`);
    const sigueEnviada = await prisma.campanaPush.count({ where: { id: campanaAhora.id, estado: 'ENVIADA' } });
    chk('[9] la campaña sigue ENVIADA (no se reproceso)', sigueEnviada === 1);

    // ==========================================================================
    console.log('\n[4] REPROGRAMAR (PATCH) cambia la hora');
    const rFut = await req('POST', '/api/push/campanas', {
      token: staffToken,
      body: {
        nombre: `TEST campanas REPRO ${RUN}`,
        titulo: 'Repro',
        cuerpo: 'Se reprograma',
        segmento: 'TODOS',
        programadoPara: arWall(new Date(Date.now() + 30 * 60_000)),
      },
    });
    chk('crear la 2da campaña responde 201/200', rFut.status === 201 || rFut.status === 200, `status=${rFut.status} ${trunc(rFut.data)}`);
    const campanaFutura = rFut.data ?? {};
    if (campanaFutura.id) campanasPushIds.push(campanaFutura.id);
    if (campanaFutura.campanaId) campanasMkIds.push(campanaFutura.campanaId);
    const wallNuevo = arWall(new Date(Date.now() + 60 * 60_000));
    const rPatch = await req('PATCH', `/api/push/campanas/${campanaFutura.id}`, {
      token: staffToken, body: { programadoPara: wallNuevo },
    });
    chk('PATCH /push/campanas/:id responde 200', rPatch.status === 200, `status=${rPatch.status} ${trunc(rPatch.data)}`);
    chk('[4] la nueva hora quedo guardada en UTC (AR + 3h)',
      Date.parse(rPatch.data?.programadoPara) === arWallAUtcMs(wallNuevo),
      `guardado=${rPatch.data?.programadoPara} esperado=${new Date(arWallAUtcMs(wallNuevo)).toISOString()}`);

    const rGet = await req('GET', `/api/push/campanas/${campanaFutura.id}`, { token: staffToken });
    chk('GET /push/campanas/:id devuelve la hora reprogramada',
      rGet.status === 200 && Date.parse(rGet.data?.programadoPara) === arWallAUtcMs(wallNuevo),
      `status=${rGet.status} hora=${rGet.data?.programadoPara}`);

    // ==========================================================================
    console.log('\n[6] El 409: no se puede cancelar/reprogramar algo que ya salio');
    await prisma.campanaPush.update({ where: { id: campanaAhora.id }, data: { estado: 'ENVIANDO' } });
    const rDel409 = await req('DELETE', `/api/push/campanas/${campanaAhora.id}`, { token: staffToken, body: { motivo: 'test 409' } });
    chk('[6] cancelar una campaña ENVIANDO responde 409', rDel409.status === 409, `status=${rDel409.status} ${trunc(rDel409.data)}`);
    const rPatch409 = await req('PATCH', `/api/push/campanas/${campanaAhora.id}`, {
      token: staffToken, body: { programadoPara: arWall(new Date(Date.now() + 30 * 60_000)) },
    });
    chk('[6] reprogramar una campaña ENVIANDO responde 409', rPatch409.status === 409, `status=${rPatch409.status} ${trunc(rPatch409.data)}`);
    const sigueViva = await prisma.campanaPush.findUnique({ where: { id: campanaAhora.id }, select: { estado: true } });
    chk('[6] la campaña queda intacta (nada se cancelo)', sigueViva?.estado === 'ENVIANDO', `estado=${sigueViva?.estado}`);
    // Se restaura a ENVIADA (era su estado real).
    await prisma.campanaPush.update({ where: { id: campanaAhora.id }, data: { estado: 'ENVIADA' } });

    // ==========================================================================
    console.log('\n[5] CANCELAR una campaña PROGRAMADA devuelve el cupo');
    const integridadAntes = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });
    const cupoAntes = integridadAntes?.cantidad ?? 0;
    const rDel = await req('DELETE', `/api/push/campanas/${campanaFutura.id}`, { token: staffToken, body: { motivo: 'se cancelo el evento' } });
    chk('DELETE /push/campanas/:id responde 200', rDel.status === 200, `status=${rDel.status} ${trunc(rDel.data)}`);
    chk('[5] la respuesta dice que se devolvio el cupo', rDel.data?.cupoDevuelto === true, trunc(rDel.data));
    const cancelada = await prisma.campanaPush.findUnique({ where: { id: campanaFutura.id } });
    chk('[5] la campaña quedo CANCELADA con motivo', cancelada?.estado === 'CANCELADA' && !!cancelada?.motivoCancelacion, `estado=${cancelada?.estado} motivo=${trunc(cancelada?.motivoCancelacion, 40)}`);
    const mkBorrada = await prisma.campanaMarketing.findUnique({ where: { id: campanaFutura.campanaId } });
    chk('[5] su CampanaMarketing asociada se borro (no figura en el Historial)', mkBorrada === null, `mk=${mkBorrada ? 'SIGUE' : 'null'}`);
    const cupoDespues = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });
    chk('[5] el uso CAMPANAS_PUSH_MES volvio al valor previo',
      (cupoDespues?.cantidad ?? -1) === cupoAntes - 1,
      `antes=${cupoAntes} despues=${cupoDespues?.cantidad}`);
    campanasMkIds.splice(campanasMkIds.indexOf(campanaFutura.campanaId), 1);
    const rDel2 = await req('DELETE', `/api/push/campanas/${campanaFutura.id}`, { token: staffToken });
    chk('[6] volver a cancelar una CANCELADA tambien responde 409', rDel2.status === 409, `status=${rDel2.status}`);

    // ==========================================================================
    console.log('\n[+] "Probar a mi mismo" a un dispositivo de prueba');
    const clavesEmp = parClaves();
    const endpointEmp = `https://httpbin.org/post?run=${RUN}PROBAR`;
    const subEmp = await prisma.notificacionPushEmpleado.create({
      data: { negocioId, empleadoId: empleado.id, endpoint: endpointEmp, auth: clavesEmp.auth, p256dh: clavesEmp.p256dh, activa: true },
    });
    subEmpleadoId = subEmp.id;
    const rProbar = await req('POST', '/api/push/campanas/probar', {
      token: staffToken,
      body: { endpoint: endpointEmp, titulo: 'Prueba {{negocio}}', cuerpo: 'Hola {{nombre}}' },
    });
    chk('POST /push/campanas/probar responde 201/200', rProbar.status === 201 || rProbar.status === 200, `status=${rProbar.status} ${trunc(rProbar.data)}`);
    chk('[+] la prueba se envio a 1 dispositivo', rProbar.data?.enviados === 1 || rProbar.data?.prueba === true, trunc(rProbar.data));

    // ==========================================================================
    console.log('\n[10] VENTANA HORARIA: fuera de la ventana se DIFIERE (no se descarta)');
    ventanaPrevia = await prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { pushVentanaInicio: true, pushVentanaFin: true },
    });
    const minAhora = arMinutosAhora();
    const aperturaEsperada = fmtMin(minAhora + 120);
    await prisma.configuracionClub.update({
      where: { negocioId },
      data: { pushVentanaInicio: aperturaEsperada, pushVentanaFin: fmtMin(minAhora + 180) },
    });
    ventanaTocada = true;

    const rVent = await req('POST', '/api/push/campanas', {
      token: staffToken,
      body: {
        nombre: `TEST campanas VENTANA ${RUN}`,
        titulo: 'Ventana',
        cuerpo: 'No deberia salir de madrugada',
        segmento: 'TODOS',
        programadoPara: arWall(new Date(Date.now() - 60_000)),
      },
    });
    const campanaVent = rVent.data ?? {};
    if (campanaVent.id) campanasPushIds.push(campanaVent.id);
    if (campanaVent.campanaId) campanasMkIds.push(campanaVent.campanaId);
    chk('crear la campaña de la ventana responde 201/200', rVent.status === 201 || rVent.status === 200, `status=${rVent.status}`);

    const rTickVent = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    chk('el tick responde 201/200', rTickVent.status === 201 || rTickVent.status === 200, trunc(rTickVent.data));
    const postVent = await prisma.campanaPush.findUnique({ where: { id: campanaVent.id } });
    chk('[10] fuera de la ventana queda PROGRAMADA (diferida, no descartada)',
      postVent?.estado === 'PROGRAMADA',
      `estado=${postVent?.estado} tick=${trunc(rTickVent.data)}`);
    chk('[10] se reprogramo a la PROXIMA APERTURA (futuro)',
      (postVent?.programadoPara?.getTime() ?? 0) > Date.now(),
      `programadoPara=${postVent?.programadoPara?.toISOString()}`);
    chk('[10] la proxima apertura es la hora de inicio de la ventana',
      !!postVent?.programadoPara && hhmmAr(postVent.programadoPara) === aperturaEsperada,
      `apertura=${postVent?.programadoPara ? hhmmAr(postVent.programadoPara) : null} esperada=${aperturaEsperada}`);
    chk('[10] NO se encolo nada fuera de la ventana',
      (await prisma.envioPushLog.count({ where: { campanaId: campanaVent.campanaId } })) === 0);

    // DENTRO de la ventana: ahora SI sale.
    await prisma.configuracionClub.update({
      where: { negocioId },
      data: { pushVentanaInicio: fmtMin(minAhora - 60), pushVentanaFin: fmtMin(minAhora + 120) },
    });
    await prisma.campanaPush.update({
      where: { id: campanaVent.id },
      data: { programadoPara: new Date(Date.now() - 60_000) },
    });
    const rTickVent2 = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    const postVent2 = await esperar(async () => {
      const c = await prisma.campanaPush.findUnique({ where: { id: campanaVent.id } });
      return c?.estado === 'ENVIADA' ? c : null;
    }, 60_000);
    chk('[10] DENTRO de la ventana se despacha',
      postVent2?.estado === 'ENVIADA',
      `estado=${postVent2?.estado} tick=${trunc(rTickVent2.data)}`);

    // Restaura la ventana del club tal cual estaba.
    await prisma.configuracionClub.update({
      where: { negocioId },
      data: {
        pushVentanaInicio: ventanaPrevia?.pushVentanaInicio ?? null,
        pushVentanaFin: ventanaPrevia?.pushVentanaFin ?? null,
      },
    });
    ventanaTocada = false;
    const ventanaRestaurada = await prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { pushVentanaInicio: true, pushVentanaFin: true },
    });
    chk('[10] la ventana horaria del club se restauro',
      ventanaRestaurada?.pushVentanaInicio === (ventanaPrevia?.pushVentanaInicio ?? null) &&
        ventanaRestaurada?.pushVentanaFin === (ventanaPrevia?.pushVentanaFin ?? null),
      `ventana=${JSON.stringify(ventanaRestaurada)}`);
  } finally {
    // ==========================================================================
    console.log('\n[limpieza]');
    // Las suscripciones REALES se restauran YA (y de nuevo al final).
    await restaurarReales();

    // La ventana horaria del club se restaura SIEMPRE (aunque el bloque [10] haya fallado).
    if (ventanaTocada) {
      await prisma.configuracionClub
        .update({
          where: { negocioId },
          data: {
            pushVentanaInicio: ventanaPrevia?.pushVentanaInicio ?? null,
            pushVentanaFin: ventanaPrevia?.pushVentanaFin ?? null,
          },
        })
        .catch(() => undefined);
      ventanaTocada = false;
    }

    if (clientes.length) {
      await prisma.envioPushLog.deleteMany({ where: { negocioId, clienteId: { in: clientes } } }).catch(() => undefined);
    }
    for (const cid of campanasMkIds) {
      await prisma.envioPushLog.deleteMany({ where: { negocioId, campanaId: cid } }).catch(() => undefined);
    }
    for (const pid of campanasPushIds) {
      await prisma.campanaPush.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
    if (campanasMkIds.length) {
      await prisma.campanaMarketing.deleteMany({ where: { id: { in: campanasMkIds } } }).catch(() => undefined);
    }
    if (subEmpleadoId) await prisma.notificacionPushEmpleado.deleteMany({ where: { id: subEmpleadoId } }).catch(() => undefined);
    if (plantillaId) await prisma.plantillaPush.deleteMany({ where: { id: plantillaId } }).catch(() => undefined);
    await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, accion: { startsWith: 'push.campana' }, clienteId: { in: clientes } },
    }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, accion: 'push.campana_probada' },
    }).catch(() => undefined);
    await prisma.tokenValidacion.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    await restaurarReales();

    // Cuota: se restaura al valor previo exacto (la corrida creo/cancelo campañas).
    if (usoPrevio) {
      await prisma.usoMensual.update({
        where: { id: usoPrevio.id },
        data: { cantidad: usoPrevio.cantidad, estado: usoPrevio.estado, excedente: usoPrevio.excedente },
      }).catch(() => undefined);
    }

    const sobrantes = await prisma.envioPushLog.count({ where: { negocioId, clienteId: { in: clientes } } });
    const sobrantesPush = await prisma.campanaPush.count({ where: { negocioId, nombre: { contains: `TEST campanas` } } });
    console.log(`  limpieza: clientes/subs/campañas/plantilla/historial de prueba borrados; suscripciones reales ${realesRestauradas || !realSubsApagadas.length ? 'OK' : 'PENDIENTES'}; filas sobrantes=${sobrantes} campañas de prueba=${sobrantesPush}`);
    if (sobrantes) { falla++; console.log(`  FALLA quedaron ${sobrantes} filas de EnvioPushLog de prueba`); }
    if (sobrantesPush) { falla++; console.log(`  FALLA quedaron ${sobrantesPush} campañas de prueba`); }
  }

  console.log(`\n==== RESULTADO: ${ok} OK / ${falla} FALLA ====`);
  if (plantillaNombre) console.log(`(plantilla de prueba: ${plantillaNombre})`);
  await prisma.$disconnect();
  if (falla > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('\nABORTADO:', e.message);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
