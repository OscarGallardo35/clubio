/**
 * Verificacion end-to-end del DISPARO DE CUMPLEANOS (fase 2 del perfilado progresivo).
 *
 *   pnpm --filter backend test:cumpleanos
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:cumpleanos
 *
 * Corre contra PROD (API + DB) y cubre:
 *  [1] Un cliente que cumple HOY recibe UN saludo; el candado queda en `DisparoPushLog`
 *      con la clave `CUMPLEANOS:<clienteId>:<anioAR>` (una vez por anio, no por dia).
 *  [2] Un 2do tick NO reenvia: el motor devuelve `duplicados` y no se escribe otro ENVIADO.
 *  [3] Un cliente que cumple en 3 dias NO recibe con `diasAntes:0`; SI con `diasAntes:3`
 *      (el saludo sale N dias ANTES del cumpleanos).
 *  [4] Un cliente SIN `fechaNacimiento` NUNCA entra.
 *  [5] El `premio: { tipo:'LIBRE', texto:'Postre de cumpleanos' }` deja un `PremioOtorgado`
 *      PENDIENTE colgado del disparo y el cliente lo ACEPTA por su token (no mueve saldo).
 *  [6] El segmento `MUJERES` del preview (`POST /push/campanas/preview`) devuelve SOLO los
 *      FEMENINO: excluye a quien no dio el dato y a PREFIERO_NO_DECIR.
 *  [7] El segmento `CUMPLEANOS_MES` incluye a los que cumplen ESTE mes (raw por EXTRACT MONTH).
 *
 * El tick se fuerza por la API (`POST /push/disparos/cumpleanos/tick`), NO encolando contra el
 * Redis local: el `.env` local tiene un `REDIS_URL` viejo, asi que un `cola.add` local no lo ve
 * el worker de prod (mismo motivo que el harness de campanas).
 *
 * NUNCA manda push a un cliente real: los destinatarios de prueba apuntan a un endpoint
 * invalido y las suscripciones REALES se apagan durante la corrida y se restauran en el
 * `finally`. El token de staff se FIRMA con el secreto del repo (nada de contrasenas).
 */
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
const trunc = (v, n = 200) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

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

// ---- hora argentina (UTC-3 fijo), mismo criterio que el backend ----
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');
function arNow() {
  const d = new Date(Date.now() - AR_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const floor15 = (m) => Math.floor(m / 15) * 15;
const fmt = (m) => { m = ((m % 1440) + 1440) % 1440; return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`; };
/** Dia de calendario guardado como lo guarda el backend: 00:00 UTC. */
const diaUtc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
/** Suma N dias a una fecha AR (y,m,d) y devuelve el (y,m,d) del resultado. */
function masDias({ y, m, d }, n) {
  const x = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

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
  const objetivo3 = masDias(hoy, 3);
  const horaAR = fmt(floor15(hoy.minutos)); // slot AR actual: deja pasar la ventana de `config.hora`
  const anioHoy = hoy.y;
  const anioObjetivo3 = objetivo3.y;
  /** Slot AR actual: se reescribe en `config.hora` antes de cada tick (cruza el borde sin fallar). */
  const slotAhora = () => fmt(floor15(arNow().minutos));
  console.log(`\n== Cumpleanos (disparos) :: ${SLUG} :: run ${RUN} :: ${API} ==`);
  console.log(`    hoy AR=${hoy.y}-${p2(hoy.m)}-${p2(hoy.d)} ${fmt(hoy.minutos)}  |  objetivo+3d=${objetivo3.y}-${p2(objetivo3.m)}-${p2(objetivo3.d)}  |  hora ventana=${horaAR}`);

  const disparos = [];
  const plantillas = [];
  const clientes = [];
  const premiosIds = [];
  let realSubsApagadas = [];

  try {
    const pl = await prisma.plantillaPush.create({
      data: { negocioId, nombre: `TEST cumple ${RUN}`, titulo: 'Feliz cumple, {{nombre}}!', cuerpo: 'Cumplis {{edad}} anios. Te esperamos en {{negocio}}.', url: '/tarjeta', activa: true },
    });
    plantillas.push(pl.id);

    // Clientes TEST: el endpoint es invalido -> el worker de prod NO puede entregar nada real.
    const crearCliente = async (nombre, genero, fecha, n) => {
      const c = await prisma.cliente.create({
        data: { negocioId, nombre: `TEST ${nombre} ${RUN}`, telefono: tel(n), aceptaNotificaciones: true, genero, fechaNacimiento: fecha, sellosActuales: 0 },
      });
      clientes.push(c.id);
      await prisma.notificacionPush.create({
        data: { negocioId, clienteId: c.id, endpoint: `https://example.invalid/webpush/${RUN}-${n}`, auth: 'test', p256dh: 'test', activa: true },
      });
      await prisma.tarjetaClienteSucursal.upsert({
        where: { clienteId_sucursalId: { clienteId: c.id, sucursalId: sucursal.id } },
        update: {}, create: { clienteId: c.id, sucursalId: sucursal.id },
      });
      return c;
    };

    // C1: cumple HOY, FEMENINO (unico del segmento MUJERES). C3: cumple HOY, PREFIERO_NO_DECIR.
    // C2: cumple en 3 dias, MASCULINO. C4: SIN fecha de nacimiento.
    const C1 = await crearCliente('cumple-hoy-fem', 'FEMENINO', diaUtc(1990, hoy.m, hoy.d), 1);
    const C2 = await crearCliente('cumple-3dias-masc', 'MASCULINO', diaUtc(1991, objetivo3.m, objetivo3.d), 2);
    const C3 = await crearCliente('cumple-hoy-pnd', 'PREFIERO_NO_DECIR', diaUtc(1992, hoy.m, hoy.d), 3);
    const C4 = await crearCliente('sin-fecha', null, null, 4);

    // Apago las suscripciones REALES durante la corrida (el tick evalua todo el negocio).
    const reales = await prisma.notificacionPush.findMany({
      where: { negocioId, activa: true, clienteId: { notIn: clientes } }, select: { id: true },
    });
    if (reales.length) {
      await prisma.notificacionPush.updateMany({ where: { id: { in: reales.map((r) => r.id) } }, data: { activa: false } });
      realSubsApagadas = reales.map((r) => r.id);
    }

    // Dos disparos CUMPLEANOS (mismo negocio): uno el dia del cumple, otro 3 dias antes.
    const dHoy = await prisma.disparoPush.create({
      data: {
        negocioId, nombre: `TEST cumple hoy ${RUN}`, tipo: 'CUMPLEANOS', activa: true,
        config: { diasAntes: 0, hora: horaAR }, plantillaId: pl.id,
        premio: { tipo: 'LIBRE', texto: 'Postre de cumpleanos' },
      },
    });
    const dAntes = await prisma.disparoPush.create({
      data: { negocioId, nombre: `TEST cumple 3d ${RUN}`, tipo: 'CUMPLEANOS', activa: true, config: { diasAntes: 3, hora: horaAR }, plantillaId: pl.id },
    });
    disparos.push(dHoy.id, dAntes.id);
    /** Reevalua la ventana horaria justo antes de cada tick (por si cruzamos el borde de 15 min). */
    const refrescarVentana = async () => {
      const h = slotAhora();
      await prisma.disparoPush.update({ where: { id: dHoy.id }, data: { config: { diasAntes: 0, hora: h } } });
      await prisma.disparoPush.update({ where: { id: dAntes.id }, data: { config: { diasAntes: 3, hora: h } } });
    };

    // ==========================================================================
    console.log('\n[1] Tick 1: cumple hoy recibe; el candado es CUMPLEANOS:<cliente>:<anioAR>');
    await refrescarVentana();
    const rTick1 = await req('POST', '/api/push/disparos/cumpleanos/tick', { token: staffToken });
    chk('POST /push/disparos/cumpleanos/tick responde 200/201', rTick1.status === 200 || rTick1.status === 201, `status=${rTick1.status} ${trunc(rTick1.data)}`);

    const logC1 = await prisma.disparoPushLog.findMany({ where: { disparoId: dHoy.id, clienteId: C1.id } });
    const enC1 = logC1.filter((l) => l.accion === 'ENVIADO');
    chk('[1] C1 (cumple hoy) tiene 1 ENVIADO', enC1.length === 1, `n=${enC1.length}`);
    chk('[1] la clave es CUMPLEANOS:<clienteId>:<anioAR> (sin la fecha)',
      enC1[0]?.clave === `CUMPLEANOS:${C1.id}:${anioHoy}`, trunc(enC1[0]?.clave));
    chk('[1] el candado encolo el push', enC1[0]?.detalle?.push?.encolados === 1, trunc(enC1[0]?.detalle?.push));

    const logC3 = await prisma.disparoPushLog.count({ where: { disparoId: dHoy.id, clienteId: C3.id, accion: 'ENVIADO' } });
    chk('[1] C3 (cumple hoy, PREFIERO_NO_DECIR) tambien recibe el saludo (no se filtra por genero)', logC3 === 1, `n=${logC3}`);

    // ==========================================================================
    console.log('\n[3] diasAntes: C2 (cumple en 3 dias) NO recibe con diasAntes:0 y SI con diasAntes:3');
    const c2Hoy = await prisma.disparoPushLog.count({ where: { disparoId: dHoy.id, clienteId: C2.id, accion: 'ENVIADO' } });
    const c2Antes = await prisma.disparoPushLog.findMany({ where: { disparoId: dAntes.id, clienteId: C2.id, accion: 'ENVIADO' } });
    chk('[3] con diasAntes:0 C2 NO recibe', c2Hoy === 0, `n=${c2Hoy}`);
    chk('[3] con diasAntes:3 C2 SI recibe', c2Antes.length === 1, `n=${c2Antes.length}`);
    chk('[3] la clave usa el anio del OBJETIVO (hoy+3d)',
      c2Antes[0]?.clave === `CUMPLEANOS:${C2.id}:${anioObjetivo3}`, trunc(c2Antes[0]?.clave));

    // ==========================================================================
    console.log('\n[4] Un cliente SIN fechaNacimiento NUNCA entra');
    const c4Hoy = await prisma.disparoPushLog.count({ where: { clienteId: C4.id } });
    chk('[4] C4 (sin fecha) no tiene ninguna fila de disparo', c4Hoy === 0, `n=${c4Hoy}`);

    // ==========================================================================
    console.log('\n[5] Premio LIBRE de cumpleanos: PENDIENTE colgado del disparo y ACEPTADO por token');
    const premio = await prisma.premioOtorgado.findFirst({ where: { negocioId, clienteId: C1.id, disparoId: dHoy.id }, orderBy: { creadoEn: 'desc' } });
    if (premio) premiosIds.push(premio.id);
    chk('[5] se creo un PremioOtorgado PENDIENTE', !!premio && premio.estado === 'PENDIENTE', trunc(premio && { estado: premio.estado, tipo: premio.tipo, texto: premio.texto }));
    chk('[5] es LIBRE con el texto del cumpleanos', premio?.tipo === 'LIBRE' && premio?.texto === 'Postre de cumpleanos', trunc(premio && { tipo: premio.tipo, texto: premio.texto }));

    const saldoAntes = (await prisma.cliente.findUnique({ where: { id: C1.id }, select: { sellosActuales: true, puntosActuales: true } })) ?? { sellosActuales: 0, puntosActuales: 0 };
    const rAcep = await req('POST', `/api/premios/${premio.token}/aceptar`);
    chk('[5] POST /premios/:token/aceptar responde 200/201', rAcep.status === 200 || rAcep.status === 201, `status=${rAcep.status} ${trunc(rAcep.data)}`);
    const premioPost = await prisma.premioOtorgado.findUnique({ where: { id: premio.id } });
    const saldoDespues = (await prisma.cliente.findUnique({ where: { id: C1.id }, select: { sellosActuales: true, puntosActuales: true } })) ?? saldoAntes;
    chk('[5] el premio quedo ACEPTADO', premioPost?.estado === 'ACEPTADO', trunc(premioPost?.estado));
    chk('[5] LIBRE no movio el saldo', saldoAntes.sellosActuales === saldoDespues.sellosActuales && saldoAntes.puntosActuales === saldoDespues.puntosActuales,
      `sellos ${saldoAntes.sellosActuales}->${saldoDespues.sellosActuales}`);

    // ==========================================================================
    console.log('\n[2] Tick 2 (mismo dia): NO reenvia (duplicados)');
    const envAntes = await prisma.disparoPushLog.count({ where: { disparoId: { in: [dHoy.id, dAntes.id] }, accion: 'ENVIADO' } });
    await refrescarVentana();
    const rTick2 = await req('POST', '/api/push/disparos/cumpleanos/tick', { token: staffToken });
    chk('el 2do tick responde 200/201', rTick2.status === 200 || rTick2.status === 201, trunc(rTick2.data));
    const envDespues = await prisma.disparoPushLog.count({ where: { disparoId: { in: [dHoy.id, dAntes.id] }, accion: 'ENVIADO' } });
    chk('[2] no se agrego ningun ENVIADO', envDespues === envAntes, `antes=${envAntes} despues=${envDespues}`);
    chk('[2] el motor reporto duplicados (OMITIDO_DUP)', Number(rTick2.data?.duplicados ?? 0) >= 1, trunc(rTick2.data));

    // ==========================================================================
    console.log('\n[6] Preview MUJERES: SOLO las FEMENINO (excluye sin dato y PREFIERO_NO_DECIR)');
    const rMuj = await req('POST', '/api/push/campanas/preview', { token: staffToken, body: { segmento: 'MUJERES' } });
    chk('POST /push/campanas/preview { MUJERES } responde 200/201', rMuj.status === 200 || rMuj.status === 201, `status=${rMuj.status} ${trunc(rMuj.data)}`);
    chk('[6] MUJERES alcanza SOLO a C1 (FEMENINO)', rMuj.data?.alcanzables === 1 && rMuj.data?.total === 1, trunc(rMuj.data));

    // ==========================================================================
    console.log('\n[7] Preview CUMPLEANOS_MES: los que cumplen ESTE mes');
    const esperadoMes = 2 + (objetivo3.m === hoy.m ? 1 : 0); // C1+C3 siempre; C2 si su mes == mes actual
    const rMes = await req('POST', '/api/push/campanas/preview', { token: staffToken, body: { segmento: 'CUMPLEANOS_MES' } });
    chk('POST /push/campanas/preview { CUMPLEANOS_MES } responde 200/201', rMes.status === 200 || rMes.status === 201, `status=${rMes.status} ${trunc(rMes.data)}`);
    chk('[7] CUMPLEANOS_MES alcanza a los del mes (sin C4)', rMes.data?.alcanzables === esperadoMes, `alcanzables=${rMes.data?.alcanzables} (esperado ${esperadoMes})`);
  } finally {
    // ==========================================================================
    console.log('\n[8] LIMPIEZA');
    await prisma.envioPushLog.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.disparoPushLog.deleteMany({ where: { disparoId: { in: disparos } } }).catch(() => undefined);
    await prisma.disparoPush.deleteMany({ where: { id: { in: disparos } } }).catch(() => undefined);
    await prisma.premioOtorgado.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.plantillaPush.deleteMany({ where: { id: { in: plantillas } } }).catch(() => undefined);
    await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, clienteId: { in: clientes }, accion: { startsWith: 'push.' } },
    }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, clienteId: { in: clientes }, accion: { startsWith: 'premio.' } },
    }).catch(() => undefined);
    if (realSubsApagadas.length) {
      await prisma.notificacionPush.updateMany({ where: { id: { in: realSubsApagadas } }, data: { activa: true } }).catch(() => undefined);
    }
    console.log('  limpieza: disparos/plantillas/clientes/subs/premios/logs/auditoria de prueba borrados; suscripciones reales restauradas');
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
