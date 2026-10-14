/**
 * Verificacion end-to-end del HISTORIAL DE ENVIOS de push (auto-verificable).
 *
 *   pnpm --filter backend test:envios-push
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:envios-push
 *
 * Corre contra PROD (API + DB). Cubre:
 *  [a] Campaña REAL por segmento -> una fila de `EnvioPushLog` por destinatario con
 *      `campanaId` seteado, estado de entrega REAL (ENVIADO) y los contadores de la
 *      campaña escritos (`totalEnviados`/`totalFallidos`, que antes nunca se escribian).
 *  [b] Fallos: un endpoint que responde 410 -> `SIN_SUSCRIPCION` con motivo '410' (y la
 *      suscripcion desactivada); uno con claves invalidas -> `FALLIDO` con motivo.
 *  [c] El bug de los 90 dias: una suscripcion con `ultimoUso` viejo que RECIBE un push
 *      queda con `ultimoUso` fresco y el barrido del cron ya no la toca.
 *  [d] El contador que mentia: enviar a `clienteIds` con uno SIN suscripcion -> el
 *      contador NO lo cuenta (destinatarios/encolados = solo los suscriptos).
 *  [e] Inmutabilidad: borrar el disparo NO borra su historial; las filas siguen y se
 *      leen con el nombre snapshoteado (`DisparoPushLog` + `EnvioPushLog`).
 *
 * NUNCA manda push a un cliente real: los destinatarios de prueba apuntan a
 * `httpbin.org` (o a un endpoint invalido) y las suscripciones REALES se apagan durante
 * la corrida y se restauran enseguida (y de nuevo en el `finally`). El token de staff se
 * FIRMA con el secreto del repo (no se usa ninguna contrasena de persona).
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

const RUN = `${Date.now().toString(36)}`;
const tel = (sufijo) => `+5****0${RUN.slice(-5)}${sufijo}`;

const CORTE_90 = new Date(Date.now() - 90 * 86_400_000);

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
  console.log(`\n== Envios push :: ${SLUG} :: run ${RUN} :: ${API} ==`);

  // --- recursos a limpiar / restaurar ---
  const clientes = [];
  const campanas = [];
  let plantillaId = null;
  let disparoEliminado = null;
  let realSubsApagadas = [];
  let realesRestauradas = false;
  let usoPrevio = null;

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
      data: { negocioId, nombre: `TEST envios pl ${RUN}`, titulo: 'Hola {{nombre}}', cuerpo: 'Llevas {{actuales}} frente a {{meta}}', url: '/tarjeta', activa: true },
    });
    plantillaId = pl.id;

    // 4 destinatarios suscriptos: A y D "entregan" (httpbin 200), B rechaza con 410,
    // C tiene claves invalidas (falla de cifrado -> FALLIDO sin statusCode).
    const defs = [
      { clave: 'A', endpoint: 'https://httpbin.org/post', claves: parClaves() },
      { clave: 'B', endpoint: 'https://httpbin.org/status/410', claves: parClaves() },
      { clave: 'C', endpoint: `https://example.invalid/webpush/${RUN}`, claves: { p256dh: 'test', auth: 'test' } },
      { clave: 'D', endpoint: 'https://httpbin.org/post', claves: parClaves(), ultimoUso: new Date(Date.now() - 100 * 86_400_000) },
    ];
    const cli = {};
    const subs = {};
    for (const d of defs) {
      const c = await prisma.cliente.create({
        data: { negocioId, nombre: `TEST ${RUN} ${d.clave}`, telefono: tel(d.clave), aceptaNotificaciones: true },
      });
      clientes.push(c.id);
      const s = await prisma.notificacionPush.create({
        data: {
          negocioId, clienteId: c.id, endpoint: d.endpoint,
          auth: d.claves.auth, p256dh: d.claves.p256dh, activa: true,
          ...(d.ultimoUso ? { ultimoUso: d.ultimoUso } : {}),
        },
      });
      cli[d.clave] = c;
      subs[d.clave] = s;
    }
    // E: SIN suscripcion (para el contador del bug [d]).
    const cliE = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST ${RUN} E`, telefono: tel('E'), aceptaNotificaciones: false },
    });
    clientes.push(cliE.id);
    cli.E = cliE;
    console.log(`    clientes: ${Object.keys(cli).join(', ')}  |  suscripciones activas de prueba: 4`);

    // Apago las suscripciones REALES para que la campaña no le llegue a nadie de verdad.
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

    // Cuota de campañas del mes: se restaura tal cual estaba (la campaña real consume 1).
    const periodo = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    usoPrevio = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: 'CAMPANAS_PUSH_MES', periodo },
    });

    // ==========================================================================
    console.log('\n[c] ANTES del push: el barrido de 90 dias SI barreria a la suscripcion vieja');
    const barridaAntes = await prisma.notificacionPush.count({
      where: { id: subs.D.id, activa: true, ultimoUso: { lt: CORTE_90 } },
    });
    chk('la suscripcion de prueba D tiene ultimoUso de hace 100 dias y la barreria el cron',
      barridaAntes === 1, `matchea=${barridaAntes} (ultimoUso=${subs.D.ultimoUso.toISOString()})`);

    // ==========================================================================
    console.log('\n[a] Campaña real por segmento TODOS (destinatarios = solo los suscriptos de prueba)');
    const rEnvio = await req('POST', '/api/push/enviar', {
      token: staffToken, body: { plantillaId: pl.id, segmento: 'TODOS' },
    });
    chk('POST /push/enviar responde 201', rEnvio.status === 201 || rEnvio.status === 200, `status=${rEnvio.status} ${trunc(rEnvio.data)}`);
    const campanaId = rEnvio.data?.campanaId;
    chk('la respuesta trae campanaId (antes no existia)', !!campanaId, `campanaId=${campanaId}`);
    chk('destinatarios = 4 (una fila por cliente suscripto)', rEnvio.data?.destinatarios === 4, trunc(rEnvio.data));
    if (campanaId) campanas.push(campanaId);

    // Las suscripciones reales ya no hacen falta: se restauran enseguida.
    await restaurarReales();
    console.log(`    suscripciones reales restauradas: ${realesRestauradas ? 'si' : 'no habia'}`);

    const filasCampana = campanaId
      ? await esperar(async () => {
          const filas = await prisma.envioPushLog.findMany({ where: { campanaId } });
          return filas.length === 4 && filas.every((f) => f.estado !== 'ENCOLADO') ? filas : null;
        }, 120_000)
      : null;
    const filas = filasCampana ?? (campanaId ? await prisma.envioPushLog.findMany({ where: { campanaId } }) : []);
    chk('EnvioPushLog tiene 1 fila por destinatario (4)', filas.length === 4, `n=${filas.length} estados=${filas.map((f) => f.estado).join(',')}`);
    chk('todas las filas tienen campanaId y jobId', filas.every((f) => f.campanaId === campanaId && !!f.jobId), `sinJobId=${filas.filter((f) => !f.jobId).length}`);

    const porCliente = new Map(filas.map((f) => [f.clienteId, f]));
    const fA = porCliente.get(cli.A.id);
    const fB = porCliente.get(cli.B.id);
    const fC = porCliente.get(cli.C.id);
    const fD = porCliente.get(cli.D.id);

    chk('[a] A: la fila quedo ENVIADO con el HTTP del proveedor',
      fA?.estado === 'ENVIADO' && !!fA?.enviadoEn && !!fA?.statusCode,
      `estado=${fA?.estado} statusCode=${fA?.statusCode} enviadoEn=${fA?.enviadoEn?.toISOString() ?? null}`);
    chk('[a] las filas guardan el snapshot del titulo y el segmento',
      fA?.campanaTitulo === 'Hola {{nombre}}' && fA?.segmento === 'TODOS',
      `titulo=${trunc(fA?.campanaTitulo)} segmento=${fA?.segmento}`);
    chk('[b] B (endpoint 410): quedo SIN_SUSCRIPCION con motivo 410',
      fB?.estado === 'SIN_SUSCRIPCION' && fB?.motivo === '410' && fB?.statusCode === 410,
      `estado=${fB?.estado} motivo=${fB?.motivo} statusCode=${fB?.statusCode}`);
    const subB = await prisma.notificacionPush.findUnique({ where: { id: subs.B.id }, select: { activa: true } });
    chk('[b] B: el procesador desactivo la suscripcion revocada', subB?.activa === false, `activa=${subB?.activa}`);
    chk('[b] C (claves invalidas): quedo FALLIDO con motivo',
      fC?.estado === 'FALLIDO' && !!fC?.motivo && !!fC?.error,
      `estado=${fC?.estado} motivo=${fC?.motivo} error=${trunc(fC?.error, 80)}`);
    chk('[b] C: el fallo tiene intentos registrados', (fC?.intentos ?? 0) >= 1, `intentos=${fC?.intentos}`);

    const camp = campanaId
      ? await prisma.campanaMarketing.findUnique({ where: { id: campanaId }, select: { totalEnviados: true, totalFallidos: true, titulo: true, segmento: true } })
      : null;
    chk('[a] la campaña tiene los contadores escritos (antes quedaban en 0)',
      camp?.totalEnviados === 2 && camp?.totalFallidos === 1,
      `totalEnviados=${camp?.totalEnviados} totalFallidos=${camp?.totalFallidos} (entregados=A,D; fallidos=C)`);

    // ==========================================================================
    console.log('\n[c] DESPUES del push: la suscripcion que RECIBIO quedo con ultimoUso fresco');
    const subD = await prisma.notificacionPush.findUnique({ where: { id: subs.D.id }, select: { activa: true, ultimoUso: true } });
    const edadMin = subD ? (Date.now() - subD.ultimoUso.getTime()) / 60_000 : Infinity;
    chk('[c] D: ultimoUso se actualizo al ENVIAR (no solo al suscribirse)', edadMin < 10, `hace ${edadMin.toFixed(2)} min`);
    const barridaDespues = await prisma.notificacionPush.count({
      where: { id: subs.D.id, activa: true, ultimoUso: { lt: CORTE_90 } },
    });
    chk('[c] D: el WHERE exacto del cron de 90 dias YA NO la toca', barridaDespues === 0, `matchea=${barridaDespues}`);
    chk('[c] D: ademas sigue activa y entrego', subD?.activa === true && fD?.estado === 'ENVIADO', `activa=${subD?.activa} estado=${fD?.estado}`);

    // ==========================================================================
    console.log('\n[d] POST /push/promocion con clienteIds: uno NO tiene suscripcion');
    const rPromo = await req('POST', '/api/push/promocion', {
      token: staffToken,
      body: { titulo: `TEST promo ${RUN}`, cuerpo: 'Promo de prueba', clienteIds: [cli.A.id, cli.E.id] },
    });
    chk('POST /push/promocion responde 201', rPromo.status === 201 || rPromo.status === 200, `status=${rPromo.status} ${trunc(rPromo.data)}`);
    chk('[d] el contador NO cuenta al cliente sin push (destinatarios = 1)', rPromo.data?.destinatarios === 1, trunc(rPromo.data));
    chk('[d] encolados = 1', rPromo.data?.encolados === 1, `encolados=${rPromo.data?.encolados}`);
    const campanaPromo = rPromo.data?.campanaId;
    if (campanaPromo) campanas.push(campanaPromo);
    const filasPromo = campanaPromo
      ? await prisma.envioPushLog.findMany({ where: { campanaId: campanaPromo } })
      : [];
    chk('[d] hay 1 fila de envio y es del cliente con suscripcion',
      filasPromo.length === 1 && filasPromo[0]?.clienteId === cli.A.id,
      `n=${filasPromo.length} cliente=${filasPromo[0]?.clienteId === cli.A.id ? 'A' : filasPromo[0]?.clienteId}`);
    chk('[d] NO existe ninguna fila del cliente sin suscripcion', !filasPromo.some((f) => f.clienteId === cli.E.id));
    const filasPromoOk = campanaPromo
      ? await esperar(async () => {
          const f = await prisma.envioPushLog.findMany({ where: { campanaId: campanaPromo } });
          return f.length && f.every((x) => x.estado !== 'ENCOLADO') ? f : null;
        }, 90_000)
      : null;
    chk('[d] el envio de la promocion llego a ENVIADO', filasPromoOk?.[0]?.estado === 'ENVIADO', `estado=${filasPromoOk?.[0]?.estado}`);

    // ==========================================================================
    console.log('\n[e] Inmutabilidad: el historial NO se borra con el disparo');
    const nombreDisparo = `TEST envios disparo ${RUN}`;
    const dManual = await prisma.disparoPush.create({
      data: { negocioId, nombre: nombreDisparo, tipo: 'MANUAL', activa: true, config: {}, plantillaId: pl.id },
    });
    const rProbar = await req('POST', `/api/push/disparos/${dManual.id}/probar`, {
      token: staffToken, body: { clienteId: cli.A.id },
    });
    chk('POST /push/disparos/:id/probar responde 201', rProbar.status === 201 || rProbar.status === 200, `status=${rProbar.status} ${trunc(rProbar.data)}`);

    const filasDisparo = await esperar(async () => {
      const f = await prisma.envioPushLog.findMany({ where: { disparoId: dManual.id } });
      return f.length && f.every((x) => x.estado !== 'ENCOLADO') ? f : null;
    }, 90_000);
    chk('[e] el push del disparo quedo en EnvioPushLog con su disparoId',
      !!filasDisparo?.[0] && filasDisparo[0].disparoId === dManual.id,
      `n=${filasDisparo?.length ?? 0} estado=${filasDisparo?.[0]?.estado}`);
    chk('[e] y con el snapshot del nombre del disparo',
      filasDisparo?.[0]?.disparoNombre === nombreDisparo, trunc(filasDisparo?.[0]?.disparoNombre));

    const logDisparo = await prisma.disparoPushLog.findMany({ where: { disparoId: dManual.id } });
    chk('[e] la ejecucion quedo en DisparoPushLog (1 fila ENVIADO)',
      logDisparo.length === 1 && logDisparo[0].accion === 'ENVIADO',
      `n=${logDisparo.length} accion=${logDisparo[0]?.accion}`);
    chk('[e] el log guarda el snapshot del disparo y de la plantilla',
      logDisparo[0]?.disparoNombre === nombreDisparo && logDisparo[0]?.plantillaNombre === pl.nombre,
      `disparoNombre=${trunc(logDisparo[0]?.disparoNombre)} plantillaNombre=${trunc(logDisparo[0]?.plantillaNombre)}`);

    // Borrado REAL por la API (camino del dueno).
    const rDel = await req('DELETE', `/api/push/disparos/${dManual.id}`, { token: staffToken });
    chk('DELETE /push/disparos/:id responde 200', rDel.status === 200, `status=${rDel.status} ${trunc(rDel.data)}`);
    disparoEliminado = dManual.id;

    const logPost = await prisma.disparoPushLog.findUnique({ where: { id: logDisparo[0].id } });
    chk('[e] el log del disparo SIGUE existiendo (no hay borrado en cascada)', !!logPost);
    chk('[e] quedo con disparoId null (onDelete SetNull) y el nombre snapshoteado',
      logPost?.disparoId === null && logPost?.disparoNombre === nombreDisparo,
      `disparoId=${logPost?.disparoId} disparoNombre=${trunc(logPost?.disparoNombre)}`);
    const envioPost = await prisma.envioPushLog.findUnique({ where: { id: filasDisparo[0].id } });
    chk('[e] el envio del disparo SIGUE existiendo', !!envioPost);
    chk('[e] tambien con disparoId null y su snapshot',
      envioPost?.disparoId === null && envioPost?.disparoNombre === nombreDisparo,
      `disparoId=${envioPost?.disparoId} disparoNombre=${trunc(envioPost?.disparoNombre)}`);

    // ==========================================================================
    console.log('\n[f] La API del historial (lo que lee el tab Historial del admin)');
    const rLogs = await req('GET', '/api/push/disparos/logs?page=1&pageSize=20', { token: staffToken });
    chk('GET /push/disparos/logs responde 200', rLogs.status === 200, `status=${rLogs.status}`);
    const filaApi = (rLogs.data?.data ?? []).find((f) => f.id === logDisparo[0].id);
    chk('[f] el historial de disparos devuelve la fila del disparo BORRADO con su nombre',
      filaApi?.disparoNombre === nombreDisparo && filaApi?.disparoId === null, trunc(filaApi));

    const rEnvios = await req('GET', '/api/push/envios/logs?page=1&pageSize=20', { token: staffToken });
    chk('GET /push/envios/logs responde 200', rEnvios.status === 200, `status=${rEnvios.status} ${trunc(rEnvios.data, 120)}`);
    const envioApi = (rEnvios.data?.data ?? []).find((f) => f.id === filasDisparo[0].id);
    chk('[f] el envio del disparo borrado tambien se lee (con el nombre snapshoteado)',
      !!envioApi && envioApi.disparoNombre === nombreDisparo, trunc(envioApi));
    const resumen = (rEnvios.data?.campanas ?? []).find((c) => c.campanaId === campanaId);
    chk('[f] el resumen por campaña trae "a cuantos les llego" desde el log',
      resumen?.enviados === 2 && resumen?.fallidos === 1 && resumen?.sinSuscripcion === 1 && resumen?.total === 4,
      trunc(resumen));
    const detalleCampana = await req('GET', `/api/push/envios/logs?page=1&pageSize=20&campanaId=${campanaId}`, { token: staffToken });
    chk('[f] el filtro por campana devuelve solo sus 4 envios',
      (detalleCampana.data?.data ?? []).length === 4 && detalleCampana.data?.total === 4,
      `n=${(detalleCampana.data?.data ?? []).length} total=${detalleCampana.data?.total}`);
    const soloFallidos = await req('GET', '/api/push/envios/logs?page=1&pageSize=20&estado=SIN_SUSCRIPCION', { token: staffToken });
    chk('[f] el filtro por estado trae la fila SIN_SUSCRIPCION con su motivo',
      (soloFallidos.data?.data ?? []).some((f) => f.id === fB?.id && f.motivo === '410'),
      `n=${(soloFallidos.data?.data ?? []).length}`);
  } finally {
    // ==========================================================================
    console.log('\n[limpieza]');
    // El disparo ya se borro por la API; sus filas quedaron huerfanas (clienteId nuestro).
    await prisma.disparoPushLog.deleteMany({ where: { negocioId, clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.envioPushLog.deleteMany({
      where: { negocioId, clienteId: { in: clientes } },
    }).catch(() => undefined);
    if (campanas.length) {
      await prisma.envioPushLog.deleteMany({ where: { negocioId, campanaId: { in: campanas } } }).catch(() => undefined);
      await prisma.campanaMarketing.deleteMany({ where: { id: { in: campanas } } }).catch(() => undefined);
    }
    if (disparoEliminado) {
      await prisma.disparoPush.updateMany({ where: { id: disparoEliminado }, data: { activa: false } }).catch(() => undefined);
      await prisma.disparoPush.deleteMany({ where: { id: disparoEliminado } }).catch(() => undefined);
    }
    if (plantillaId) await prisma.plantillaPush.deleteMany({ where: { id: plantillaId } }).catch(() => undefined);
    await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, clienteId: { in: clientes }, accion: { startsWith: 'push.' } },
    }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    await restaurarReales();
    // Cuota de campañas: la campana real de prueba se borro, el uso vuelve a su valor.
    if (usoPrevio) {
      await prisma.usoMensual.update({
        where: { id: usoPrevio.id },
        data: { cantidad: usoPrevio.cantidad, estado: usoPrevio.estado, excedente: usoPrevio.excedente },
      }).catch(() => undefined);
    }
    const sobrantes = await prisma.envioPushLog.count({ where: { negocioId, clienteId: { in: clientes } } });
    console.log(`  limpieza: clientes/subs/campañas/plantilla/historial de prueba borrados; suscripciones reales ${realesRestauradas || !realSubsApagadas.length ? 'OK' : 'PENDIENTES'}; filas sobrantes=${sobrantes}`);
    if (sobrantes) { falla++; console.log(`  FALLA quedaron ${sobrantes} filas de EnvioPushLog de prueba`); }
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
