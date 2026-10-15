/**
 * Verificacion end-to-end del GATE del switch "Acepta notificaciones" (marketing vs transaccional).
 *
 *   pnpm --filter backend test:acepta-notificaciones
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:acepta-notificaciones
 *
 * Corre contra PROD (API + DB) y cubre:
 *  [1] DISPARO (CUMPLEANOS) con el switch APAGADO: el cliente NO entra en `destinatarios()`,
 *      asi que no existe NINGUNA fila de `DisparoPushLog` para el; un cliente con el switch
 *      PRENDIDO (mismo disparo, mismo tick) SI recibe el saludo -> la diferencia es el switch.
 *  [2] El MISMO cliente, prendido el switch, entra en el tick siguiente (no era el motor).
 *  [3] PREVIEW: el "N de M" de `/push/campanas/preview` refleja el filtro (prender el switch
 *      de UN cliente sube `alcanzables` y `total` en exactamente 1) y el desglose lo cuenta
 *      aparte (`sinAcepta`).
 *  [4] ENVIO REAL de una campana (despacho por tick): el apagado no se encola ni deja fila de
 *      `EnvioPushLog`; el encendido si. El preview coincide con lo encolado (no miente).
 *  [5] TRANSACCIONAL: el push del estado del pedido (`pedidos.service` -> `enviarACliente`)
 *      SIGUE SALIENDO con el switch apagado (no se gateo de mas). Se ve en la auditoria que
 *      escribe el worker de prod al procesar el job (`push.enviado` / `push.fallido`).
 *
 * El tick se fuerza por la API (`POST /push/campanas/tick` y `POST /push/disparos/cumpleanos/tick`),
 * NO encolando contra el Redis local: el `.env` local tiene un `REDIS_URL` viejo, asi que un
 * `cola.add` local no lo ve el worker de prod (mismo motivo que los harness de campanas y cumpleanos).
 *
 * NUNCA manda push a un cliente real: los destinatarios de prueba apuntan a `httpbin.org` y las
 * suscripciones REALES se apagan durante la corrida y se restauran en el `finally`. El token de
 * staff se FIRMA con el secreto del repo (no se usa ninguna contrasena de persona).
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

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

/** Poller: devuelve el primer resultado "verdadero" o null si se agota el tiempo. */
async function esperar(fn, timeoutMs = 90_000, intervaloMs = 3_000) {
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

// ---- hora argentina (UTC-3 fijo), mismo criterio que el backend ----
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');
function arNow() {
  const d = new Date(Date.now() - AR_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const floor15 = (m) => Math.floor(m / 15) * 15;
const fmtMin = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${p2(Math.floor(x / 60))}:${p2(x % 60)}`; };
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
/** Dia de calendario guardado como lo guarda el backend: 00:00 UTC. */
const diaUtc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const RUN = Date.now().toString(36);
const DIG = String(Date.now() % 1_000_000).padStart(6, '0');
const tel = (n) => `+54911${DIG}${n}`;

async function main() {
  const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG, activo: true }, select: { id: true, nombre: true } });
  if (!negocio) throw new Error(`No existe el negocio ${SLUG}`);
  const negocioId = negocio.id;

  const empleado = await prisma.empleado.findFirst({
    where: { negocioId, activo: true, eliminadoEn: null, rol: { in: ['DUENO', 'ENCARGADO'] } },
    select: { id: true, rol: true, sucursalId: true },
  });
  if (!empleado) throw new Error('Sin empleado DUENO/ENCARGADO');
  const sucursal = await prisma.sucursal.findFirst({ where: { negocioId, esPrincipal: true, activa: true }, select: { id: true } });

  const secret = process.env.JWT_EMPLEADO_SECRET;
  if (!secret) throw new Error('Falta JWT_EMPLEADO_SECRET en el entorno');
  const staffToken = jwt.sign(
    { sub: empleado.id, tipo: 'empleado', negocioId, negocioSlug: SLUG, rol: empleado.rol, sucursalId: empleado.sucursalId },
    secret, { expiresIn: '1h' },
  );

  const hoy = arNow();
  const slotAhora = () => fmtMin(floor15(arNow().minutos));
  console.log(`\n== Gate "acepta notificaciones" :: ${SLUG} :: run ${RUN} :: ${API} ==`);
  console.log(`    hoy AR=${hoy.y}-${p2(hoy.m)}-${p2(hoy.d)} ${fmtMin(hoy.minutos)}  |  slot ventana=${slotAhora()}`);

  // --- recursos a limpiar / restaurar ---
  const clientes = [];
  const disparos = [];
  const plantillas = [];
  const pedidos = [];
  let campanaPushId = null;
  let campanaMkId = null;
  let realSubsApagadas = [];
  let realesRestauradas = false;
  let usosPrevios = [];
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
    console.log('\n[setup] Plantilla + dos clientes de prueba que cumplen HOY (uno apagado, uno prendido)');
    const pl = await prisma.plantillaPush.create({
      data: { negocioId, nombre: `TEST gate pl ${RUN}`, titulo: 'Feliz cumple, {{nombre}}!', cuerpo: 'Te esperamos en {{negocio}}.', url: '/tarjeta', activa: true },
    });
    plantillas.push(pl.id);

    const crearCliente = async (nombre, acepta, n) => {
      const claves = parClaves();
      const c = await prisma.cliente.create({
        data: {
          negocioId, nombre: `${nombre} ${RUN}`, telefono: tel(n),
          aceptaNotificaciones: acepta, sellosActuales: 0,
          fechaNacimiento: diaUtc(1990, hoy.m, hoy.d),
        },
      });
      clientes.push(c.id);
      await prisma.notificacionPush.create({
        data: { negocioId, clienteId: c.id, endpoint: `https://httpbin.org/post?run=${RUN}-${n}`, auth: claves.auth, p256dh: claves.p256dh, activa: true },
      });
      await prisma.tarjetaClienteSucursal.upsert({
        where: { clienteId_sucursalId: { clienteId: c.id, sucursalId: sucursal.id } },
        update: {}, create: { clienteId: c.id, sucursalId: sucursal.id },
      });
      return c;
    };

    const C_OFF = await crearCliente('TEST gate OFF', false, 1);
    const C_ON = await crearCliente('TEST gate ON', true, 2);
    console.log(`    OFF=${C_OFF.id}  ON=${C_ON.id}`);

    // Apago las suscripciones REALES: los ticks no deben llegarle a nadie de verdad.
    const reales = await prisma.notificacionPush.findMany({
      where: { negocioId, activa: true, clienteId: { notIn: clientes } }, select: { id: true },
    });
    if (reales.length) {
      await prisma.notificacionPush.updateMany({ where: { id: { in: reales.map((r) => r.id) } }, data: { activa: false } });
      realSubsApagadas = reales.map((r) => r.id);
    }
    console.log(`    suscripciones reales apagadas durante la corrida: ${realSubsApagadas.length}`);

    usosPrevios = await prisma.usoMensual.findMany({
      where: { negocioId, sucursalId: null, recurso: { in: ['CAMPANAS_PUSH_MES', 'PEDIDOS_MES'] }, periodo: { in: [periodo, 'TOTAL'] } },
    });
    // La VENTANA horaria de push se abre durante la corrida (si el club tiene una, una campana
    // fuera de ventana queda diferida y no despacharia). Se restaura en el `finally`.
    ventanaPrevia = await prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { pushVentanaInicio: true, pushVentanaFin: true },
    });
    if (ventanaPrevia) {
      const ahoraMin = arNow().minutos;
      await prisma.configuracionClub.update({
        where: { negocioId },
        data: { pushVentanaInicio: fmtMin(ahoraMin - 120), pushVentanaFin: fmtMin(ahoraMin + 240) },
      });
      ventanaTocada = true;
    }

    // Un disparo CUMPLEANOS con la hora en la ventana actual: el tick lo evalua ya.
    const dCumple = await prisma.disparoPush.create({
      data: {
        negocioId, nombre: `TEST gate cumple ${RUN}`, tipo: 'CUMPLEANOS', activa: true,
        config: { diasAntes: 0, hora: slotAhora() }, plantillaId: pl.id,
      },
    });
    disparos.push(dCumple.id);
    const refrescarVentana = async () => {
      await prisma.disparoPush.update({ where: { id: dCumple.id }, data: { config: { diasAntes: 0, hora: slotAhora() } } });
    };

    // ==========================================================================
    console.log('\n[1] DISPARO con el switch APAGADO: no entra; el PRENDIDO si');
    await refrescarVentana();
    const rT1 = await req('POST', '/api/push/disparos/cumpleanos/tick', { token: staffToken });
    chk('POST /push/disparos/cumpleanos/tick responde 200/201', rT1.status === 200 || rT1.status === 201, `status=${rT1.status} ${trunc(rT1.data)}`);

    const logOn = await prisma.disparoPushLog.findMany({ where: { disparoId: dCumple.id, clienteId: C_ON.id } });
    const logOff = await prisma.disparoPushLog.findMany({ where: { disparoId: dCumple.id, clienteId: C_OFF.id } });
    chk('[1] el cliente PRENDIDO tiene 1 ENVIADO', logOn.filter((l) => l.accion === 'ENVIADO').length === 1, `n=${logOn.length} acciones=${logOn.map((l) => l.accion).join(',')}`);
    chk('[1] el push del prendido se encolo', logOn[0]?.detalle?.push?.encolados === 1, trunc(logOn[0]?.detalle?.push));
    chk('[1] el cliente APAGADO no tiene NINGUNA fila del disparo', logOff.length === 0, `n=${logOff.length} acciones=${logOff.map((l) => l.accion).join(',')}`);

    // ==========================================================================
    console.log('\n[2] El MISMO cliente con el switch PRENDIDO: entra en el tick siguiente');
    await prisma.cliente.update({ where: { id: C_OFF.id }, data: { aceptaNotificaciones: true } });
    await refrescarVentana();
    const rT2 = await req('POST', '/api/push/disparos/cumpleanos/tick', { token: staffToken });
    chk('2do tick responde 200/201', rT2.status === 200 || rT2.status === 201, trunc(rT2.data));
    const logOff2 = await prisma.disparoPushLog.findMany({ where: { disparoId: dCumple.id, clienteId: C_OFF.id } });
    chk('[2] ahora SI tiene 1 ENVIADO (el candado es por cliente)', logOff2.filter((l) => l.accion === 'ENVIADO').length === 1, `n=${logOff2.length} acciones=${logOff2.map((l) => l.accion).join(',')}`);
    const soloUno = await prisma.disparoPushLog.count({ where: { disparoId: dCumple.id, clienteId: C_ON.id, accion: 'ENVIADO' } });
    chk('[2] el prendido NO se duplico (candado una vez por anio)', soloUno === 1, `n=${soloUno}`);

    // ==========================================================================
    console.log('\n[3] PREVIEW: el "N de M" refleja el filtro del switch');
    const rPrevOn = await req('POST', '/api/push/campanas/preview', { token: staffToken, body: { segmento: 'TODOS' } });
    chk('preview (switch prendido) responde 200/201', rPrevOn.status === 200 || rPrevOn.status === 201, `status=${rPrevOn.status} ${trunc(rPrevOn.data)}`);
    const prevOn = rPrevOn.data ?? {};

    await prisma.cliente.update({ where: { id: C_OFF.id }, data: { aceptaNotificaciones: false } });
    const rPrevOff = await req('POST', '/api/push/campanas/preview', { token: staffToken, body: { segmento: 'TODOS' } });
    chk('preview (switch apagado) responde 200/201', rPrevOff.status === 200 || rPrevOff.status === 201, `status=${rPrevOff.status} ${trunc(rPrevOff.data)}`);
    const prevOff = rPrevOff.data ?? {};

    chk('[3] apagar el switch baja `alcanzables` (N) exactamente en 1',
      prevOn.alcanzables === (prevOff.alcanzables ?? -1) + 1,
      `prendido=${prevOn.alcanzables} apagado=${prevOff.alcanzables}`);
    chk('[3] y baja `total` (M) exactamente en 1',
      prevOn.total === (prevOff.total ?? -1) + 1,
      `prendido=${prevOn.total} apagado=${prevOff.total}`);
    chk('[3] el desglose lo cuenta aparte en `sinAcepta`',
      prevOff.desglose?.sinAcepta === (prevOn.desglose?.sinAcepta ?? -1) + 1,
      `prendido=${prevOn.desglose?.sinAcepta} apagado=${prevOff.desglose?.sinAcepta}`);
    chk('[3] el apagado no se cuenta como "sin suscripcion" (tiene dispositivo)',
      prevOff.desglose?.sinSuscripcionActiva === prevOn.desglose?.sinSuscripcionActiva,
      `prendido=${prevOn.desglose?.sinSuscripcionActiva} apagado=${prevOff.desglose?.sinSuscripcionActiva}`);

    // ==========================================================================
    console.log('\n[4] ENVIO REAL de una campana programada (despacho por tick)');
    const rCrear = await req('POST', '/api/push/campanas', {
      token: staffToken,
      body: {
        nombre: `TEST gate campana ${RUN}`, plantillaId: pl.id,
        titulo: 'Promo {{negocio}}', cuerpo: 'Hola {{nombre}}', url: '/tarjeta',
        segmento: 'TODOS', programadoPara: arWall(new Date(Date.now() + 30 * 60_000)),
      },
    });
    chk('POST /push/campanas responde 201/200', rCrear.status === 201 || rCrear.status === 200, `status=${rCrear.status} ${trunc(rCrear.data)}`);
    campanaPushId = rCrear.data?.id ?? null;
    campanaMkId = rCrear.data?.campanaId ?? null;
    chk('la campana nace PROGRAMADA con su campanaId', rCrear.data?.estado === 'PROGRAMADA' && !!campanaMkId, trunc(rCrear.data));

    // Vence la campana (solo la fecha en la DB: el despacho sigue siendo el camino real).
    await prisma.campanaPush.update({ where: { id: campanaPushId }, data: { programadoPara: new Date(Date.now() - 60_000) } });
    const rTick = await req('POST', '/api/push/campanas/tick', { token: staffToken });
    chk('POST /push/campanas/tick responde 201/200', rTick.status === 201 || rTick.status === 200, trunc(rTick.data));

    const enviada = await esperar(async () => {
      const c = await prisma.campanaPush.findUnique({ where: { id: campanaPushId } });
      return c?.estado === 'ENVIADA' ? c : null;
    }, 90_000);
    chk('[4] la campana quedo ENVIADA', !!enviada?.enviadaEn, `estado=${enviada?.estado} tick=${trunc(rTick.data)}`);

    const filas = await prisma.envioPushLog.findMany({ where: { campanaId: campanaMkId } });
    const encolados = filas.filter((f) => f.estado !== 'SUPRIMIDO_EXCLUIDO' && f.clienteId);
    chk('[4] el PRENDIDO se encolo (fila con su clienteId y jobId)',
      encolados.some((f) => f.clienteId === C_ON.id && !!f.jobId),
      `clientes=${encolados.map((f) => f.clienteId).join(',')}`);
    chk('[4] el APAGADO no tiene NINGUNA fila de la campana',
      !filas.some((f) => f.clienteId === C_OFF.id),
      `filas=${filas.length} delApagado=${filas.filter((f) => f.clienteId === C_OFF.id).length}`);
    chk('[4] el ENVIO REAL encolo tantos como dijo el preview (no miente)',
      encolados.length === prevOff.alcanzables,
      `encolados=${encolados.length} preview=${prevOff.alcanzables}`);

    const envioOk = await esperar(async () => {
      const f = await prisma.envioPushLog.findMany({ where: { campanaId: campanaMkId } });
      return f.length > 0 && f.every((x) => x.estado !== 'ENCOLADO') ? f : null;
    }, 120_000);
    const filaOn = (envioOk ?? filas).find((f) => f.clienteId === C_ON.id);
    chk('[4] el prendido llego a ENVIADO con el HTTP del proveedor',
      filaOn?.estado === 'ENVIADO' && !!filaOn?.statusCode,
      `estado=${filaOn?.estado} statusCode=${filaOn?.statusCode}`);

    // ==========================================================================
    console.log('\n[5] TRANSACCIONAL: el aviso del PEDIDO sale igual con el switch APAGADO');
    const pedido = await prisma.pedido.create({
      data: {
        negocioId, sucursalId: sucursal.id, clienteId: C_OFF.id,
        nombreCliente: `TEST gate pedido ${RUN}`, telefono: tel(3), tipo: 'TAKEAWAY', modoPago: 'EFECTIVO',
        items: [], subtotal: 1000, total: 1000, estado: 'PENDIENTE',
      },
    });
    pedidos.push(pedido.id);
    const antesAudit = await prisma.eventoAuditoria.count({
      where: { negocioId, accion: { in: ['push.enviado', 'push.fallido'] }, detalle: { path: ['destinatario'], equals: C_OFF.id } },
    });
    const rEstado = await req('PATCH', `/api/pedidos/${pedido.id}/estado`, { token: staffToken, body: { estado: 'CONFIRMADO' } });
    chk('PATCH /pedidos/:id/estado -> CONFIRMADO responde 200', rEstado.status === 200, `status=${rEstado.status} ${trunc(rEstado.data)}`);

    const audit = await esperar(async () => {
      const n = await prisma.eventoAuditoria.count({
        where: { negocioId, accion: { in: ['push.enviado', 'push.fallido'] }, detalle: { path: ['destinatario'], equals: C_OFF.id } },
      });
      return n > antesAudit ? n : null;
    }, 90_000);
    const filaAudit = await prisma.eventoAuditoria.findFirst({
      where: { negocioId, accion: { in: ['push.enviado', 'push.fallido'] }, detalle: { path: ['destinatario'], equals: C_OFF.id } },
      orderBy: { creadoEn: 'desc' },
    });
    chk('[5] el worker de prod PROCESO el push del pedido del cliente apagado',
      audit !== null, `filas nuevas=${audit === null ? 0 : audit - antesAudit} accion=${filaAudit?.accion}`);
    chk('[5] el aviso fue el del pedido (no una campana ni un disparo)',
      filaAudit?.detalle?.destino === 'cliente' && filaAudit?.detalle?.total >= 1,
      trunc(filaAudit?.detalle));
    chk('[5] el switch sigue APAGADO en la DB (no lo cambio este camino)',
      (await prisma.cliente.findUnique({ where: { id: C_OFF.id }, select: { aceptaNotificaciones: true } }))?.aceptaNotificaciones === false);
  } finally {
    // ==========================================================================
    console.log('\n[limpieza]');
    await restaurarReales();
    if (ventanaTocada) {
      await prisma.configuracionClub
        .update({
          where: { negocioId },
          data: { pushVentanaInicio: ventanaPrevia?.pushVentanaInicio ?? null, pushVentanaFin: ventanaPrevia?.pushVentanaFin ?? null },
        })
        .catch(() => undefined);
      ventanaTocada = false;
    }
    if (clientes.length) {
      await prisma.envioPushLog.deleteMany({ where: { negocioId, clienteId: { in: clientes } } }).catch(() => undefined);
      await prisma.disparoPushLog.deleteMany({ where: { disparoId: { in: disparos } } }).catch(() => undefined);
      await prisma.eventoAuditoria.deleteMany({
        where: { negocioId, accion: { in: ['push.enviado', 'push.fallido'] }, OR: clientes.map((id) => ({ detalle: { path: ['destinatario'], equals: id } })) },
      }).catch(() => undefined);
      await prisma.eventoAuditoria.deleteMany({
        where: { negocioId, OR: clientes.map((id) => ({ detalle: { path: ['destinatario'], equals: id } })) },
      }).catch(() => undefined);
      await prisma.visita.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    }
    if (pedidos.length) {
      await prisma.pedido.deleteMany({ where: { id: { in: pedidos } } }).catch(() => undefined);
    }
    if (campanaMkId) await prisma.envioPushLog.deleteMany({ where: { campanaId: campanaMkId } }).catch(() => undefined);
    if (campanaPushId) await prisma.campanaPush.deleteMany({ where: { id: campanaPushId } }).catch(() => undefined);
    if (campanaMkId) await prisma.campanaMarketing.deleteMany({ where: { id: campanaMkId } }).catch(() => undefined);
    if (disparos.length) await prisma.disparoPush.deleteMany({ where: { id: { in: disparos } } }).catch(() => undefined);
    if (plantillas.length) await prisma.plantillaPush.deleteMany({ where: { id: { in: plantillas } } }).catch(() => undefined);
    if (clientes.length) {
      await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
      await prisma.tokenValidacion.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
      await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
      await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    }
    await restaurarReales();

    // Cuota: se restaura al valor previo exacto (la corrida creo una campana y un pedido).
    for (const u of usosPrevios) {
      await prisma.usoMensual
        .update({ where: { id: u.id }, data: { cantidad: u.cantidad, estado: u.estado, excedente: u.excedente } })
        .catch(() => undefined);
    }

    const sobrantes = clientes.length
      ? await prisma.cliente.count({ where: { id: { in: clientes } } })
      : 0;
    const sobrantesCampana = campanaPushId
      ? await prisma.campanaPush.count({ where: { id: campanaPushId } })
      : 0;
    console.log(`  limpieza: clientes/subs/disparo/plantilla/campana/pedido/historial/auditoria borrados; suscripciones reales ${realesRestauradas || !realSubsApagadas.length ? 'OK' : 'PENDIENTES'}; sobrantes=${sobrantes} campanas=${sobrantesCampana}`);
    if (sobrantes) { falla++; console.log(`  FALLA quedaron ${sobrantes} clientes de prueba`); }
    if (sobrantesCampana) { falla++; console.log('  FALLA quedo la campana de prueba'); }
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
