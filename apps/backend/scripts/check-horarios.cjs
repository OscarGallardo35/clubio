/**
 * Harness E2E de HORARIOS DE ATENCION Y DE DELIVERY (auto-verificable).
 *
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:horarios
 *
 * Que prueba:
 *   [1] REGRESION: un local SIN horarios configurados acepta pedidos igual (default "siempre
 *       abierto"). Se prueba contra un negocio de PRUEBA con horarios en null.
 *   [2] CERRADO: con la grilla que excluye AHORA, `POST /pedidos` responde 400 con
 *       `proximaApertura` (bloqueo CON AVISO, decision del producto).
 *   [3] ABIERTO: abriendo la franja, el MISMO pedido pasa (201).
 *   [4] EXCEPCION: `ExcepcionHorario` de hoy bloquea aunque la grilla abra.
 *   [5] DELIVERY: atencion abierta + delivery cerrado => el DELIVERY se bloquea y un MESA pasa.
 *   [6] REGRESION de los DOS tenants reales (que-lomitos, bar-la-esquina): sin horarios, el
 *       backend reporta SIN_HORARIOS / abierto (lectura, no se escribe nada).
 *
 * El "ahora" no se puede inyectar por HTTP, asi que las grillas se arman RELATIVAS a la hora
 * argentina actual: "cerrado" = el dia de hoy sin franjas; "abierto" = 24 h partido en dos
 * rangos (00:00-12:00 + 12:00-00:00). No depende de en que minuto corre.
 *
 * Se escribe SIEMPRE por la API (con un token de dueno FIRMADO), no por Prisma: `PATCH
 * /configuracion` invalida la config efectiva cacheada, que si no quedaria vieja 5 minutos.
 *
 * NO toca datos de clientes reales: crea un negocio de PRUEBA (slug `test-horarios-XXXX`) con su
 * sucursal/carta/dueno y lo BORRA en el `finally`. `.env` local tiene un REDIS_URL viejo: si algo
 * de cache fallara por eso, es esperado y no es de este cambio.
 */
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const API = (process.env.API_URL || 'https://api.clubio.lat').replace(/\/$/, '');
const prisma = new PrismaClient();

let ok = 0;
let falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 160) => String(typeof v === 'string' ? v : JSON.stringify(v ?? '')).slice(0, n);

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIAS_GETDAY = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

function ahoraAr(base = new Date()) {
  const ar = new Date(base.getTime() - AR_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return { fecha: `${ar.getUTCFullYear()}-${p(ar.getUTCMonth() + 1)}-${p(ar.getUTCDate())}`, dia: DIAS_GETDAY[ar.getUTCDay()] };
}
function fechaMas(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const o = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  const p = (x) => String(x).padStart(2, '0');
  return `${o.getUTCFullYear()}-${p(o.getUTCMonth() + 1)}-${p(o.getUTCDate())}`;
}

/** 24 h abierto, partido en dos rangos (el segundo cruza medianoche y cubre 12:00-24:00). */
const RANGOS_24H = [{ desde: '00:00', hasta: '12:00' }, { desde: '12:00', hasta: '00:00' }];
/** Grilla ABIERTA: los 7 dias, 24 h. */
function gridAbierta() {
  const g = {};
  for (const d of DIAS) g[d] = RANGOS_24H.map((r) => ({ ...r }));
  return g;
}
/** Grilla CERRADA ahora: el dia de hoy sin franjas, el resto abierto (=> proximaApertura manana). */
function gridCerradaHoy(diaHoy) {
  const g = gridAbierta();
  g[diaHoy] = [];
  return g;
}

async function req(method, path, { body, token, slug } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (slug) headers['X-Tenant-Slug'] = slug;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

function firmarDueno(empleadoId, negocioId, negocioSlug) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: empleadoId, negocioId, negocioSlug, rol: 'DUENO',
    sucursalId: null, tipo: 'dueno', jti: crypto.randomUUID(),
    iat: ahora, exp: ahora + 1800,
  });
  const firma = crypto.createHmac('sha256', process.env.JWT_DUENO_SECRET).update(`${cabecera}.${payload}`).digest('base64url');
  return `${cabecera}.${payload}.${firma}`;
}

/** `POST /pedidos` bien formado para el negocio de prueba. */
function cuerpoPedido(itemId, tipo, telefono) {
  return {
    tipo,
    modoPago: 'EFECTIVO',
    nombreCliente: 'Test Horarios',
    telefono,
    items: [{ itemId, cantidad: 1 }],
    ...(tipo === 'MESA' ? { mesa: '1' } : {}),
    ...(tipo === 'DELIVERY' ? { direccion: 'Calle de prueba 123' } : {}),
  };
}

const SLUG = `test-horarios-${Date.now().toString(36)}`;
let negocioId = null;

(async () => {
  console.log(`API: ${API}\n`);
  const { fecha: hoyAr, dia: diaHoy } = ahoraAr();
  console.log(`Negocio de prueba: ${SLUG}   (hoy AR: ${hoyAr} ${diaHoy})\n`);

  let token = '';
  let sucursalId = null;
  let itemId = null;
  let contadorTel = 0;
  const tel = () => `+5491100${String(++contadorTel).padStart(5, '0')}`;

  try {
    // ---------------- setup: negocio de PRUEBA ----------------
    const negocio = await prisma.negocio.create({
      data: { nombre: 'Test Horarios', slug: SLUG, plan: 'PRO', modoClientes: 'GLOBAL', activo: true },
    });
    negocioId = negocio.id;
    const sucursal = await prisma.sucursal.create({
      data: { negocioId, nombre: 'Centro', slug: 'centro', esPrincipal: true, activa: true },
    });
    sucursalId = sucursal.id;
    const item = await prisma.itemCarta.create({
      data: { negocioId, categoria: 'Test', nombre: 'Milanesa', precio: new Prisma.Decimal(1000), disponible: true },
    });
    itemId = item.id;
    await prisma.configuracionClub.create({
      data: {
        negocioId, premioTexto: 'Test', menuActivo: true,
        tiposPedidoHabilitados: ['MESA', 'DELIVERY'], modosPagoHabilitados: ['EFECTIVO'],
        costoEnvio: new Prisma.Decimal(150), modoAsignacionPedidos: 'BROADCAST', turnosActivos: false,
        // Arranca SIN horarios: es el estado de "siempre abierto".
        horariosAtencion: Prisma.DbNull, horariosDelivery: Prisma.DbNull,
      },
    });
    const dueno = await prisma.empleado.create({
      data: { negocioId, sucursalId, nombre: 'Test Dueno', rol: 'DUENO', activo: true },
    });
    token = firmarDueno(dueno.id, negocioId, SLUG);

    // ---------------- [1] REGRESION: sin horarios entra ----------------
    let r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'MESA', tel()), slug: SLUG });
    chk('[1] sin horarios: el pedido MESA entra (201)', r.status === 201, `status ${r.status} ${trunc(r.data)}`);
    if (r.status === 201) {
      const p = await prisma.pedido.findUnique({ where: { id: r.data.pedidoId }, select: { id: true, tipo: true } });
      chk('[1] el pedido quedo guardado en la DB', !!p, p ? p.tipo : 'no');
      // Se cancela para no dejar un pedido "activo" que bloquee los intentos siguientes del mismo telefono.
      await prisma.pedido.delete({ where: { id: r.data.pedidoId } }).catch(() => undefined);
    }

    // ---------------- [2] CERRADO: 400 con aviso + proximaApertura ----------------
    let patch = await req('PATCH', '/api/configuracion', {
      body: { horariosAtencion: gridCerradaHoy(diaHoy), horariosDelivery: null }, token, slug: SLUG,
    });
    chk('[2] PATCH /configuracion guarda la grilla cerrada (200)', patch.status === 200, `status ${patch.status} ${trunc(patch.data)}`);

    r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'MESA', tel()), slug: SLUG });
    const mensaje = r.data?.mensaje ?? r.data?.message ?? '';
    chk('[2] cerrado: POST /pedidos responde 400', r.status === 400, `status ${r.status}`);
    chk('[2] el 400 trae el aviso ("cerrado")', /cerrad/i.test(String(mensaje)), trunc(mensaje, 90));
    chk('[2] el 400 trae proximaApertura (no null)', !!r.data?.proximaApertura, String(r.data?.proximaApertura));

    // ---------------- [3] ABIERTO: abre la franja y el pedido pasa ----------------
    patch = await req('PATCH', '/api/configuracion', {
      body: { horariosAtencion: gridAbierta() }, token, slug: SLUG,
    });
    chk('[3] PATCH /configuracion abre la grilla (200)', patch.status === 200, `status ${patch.status}`);

    r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'MESA', tel()), slug: SLUG });
    chk('[3] abierto: el mismo pedido MESA entra (201)', r.status === 201, `status ${r.status} ${trunc(r.data)}`);
    const pedidoAbiertoId = r.status === 201 ? r.data.pedidoId : null;
    if (pedidoAbiertoId) await prisma.pedido.delete({ where: { id: pedidoAbiertoId } }).catch(() => undefined);

    // ---------------- [4] EXCEPCION: "hoy cerrado" bloquea con la grilla ABIERTA ----------------
    const exc = await req('POST', '/api/horarios/excepciones', {
      body: { desdeFecha: hoyAr, hastaFecha: hoyAr, motivo: 'Harness horarios' }, token, slug: SLUG,
    });
    chk('[4] POST /horarios/excepciones crea el cierre de hoy (201)', exc.status === 201, `status ${exc.status} ${trunc(exc.data)}`);

    r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'MESA', tel()), slug: SLUG });
    chk('[4] feriado/cierre de hoy: el pedido se bloquea (400)', r.status === 400, `status ${r.status} ${trunc(r.data)}`);

    if (exc.status === 201) {
      const del = await req('DELETE', `/api/horarios/excepciones/${exc.data.id}`, { token, slug: SLUG });
      chk('[4] DELETE de la excepcion (200)', del.status === 200, `status ${del.status}`);
    }

    // ---------------- [5] DELIVERY: atencion abierta + delivery cerrado ----------------
    patch = await req('PATCH', '/api/configuracion', {
      body: { horariosAtencion: gridAbierta(), horariosDelivery: gridCerradaHoy(diaHoy) }, token, slug: SLUG,
    });
    chk('[5] PATCH guarda atencion abierta + delivery cerrado (200)', patch.status === 200, `status ${patch.status}`);

    r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'DELIVERY', tel()), slug: SLUG });
    chk('[5] DELIVERY cerrado: el pedido DELIVERY se bloquea (400)', r.status === 400, `status ${r.status} ${trunc(r.data)}`);
    chk('[5] el 400 del delivery trae proximaApertura', !!r.data?.proximaApertura, String(r.data?.proximaApertura));

    r = await req('POST', '/api/pedidos', { body: cuerpoPedido(itemId, 'MESA', tel()), slug: SLUG });
    chk('[5] atencion abierta: un MESA PASA aunque el delivery este cerrado (201)', r.status === 201, `status ${r.status} ${trunc(r.data)}`);
    if (r.status === 201) await prisma.pedido.delete({ where: { id: r.data.pedidoId } }).catch(() => undefined);

    // ---------------- [7] LECTURA PUBLICA: la carta del cliente trae la grilla + las excepciones ----------------
    const excPub = await req('POST', '/api/horarios/excepciones', {
      body: { desdeFecha: hoyAr, hastaFecha: hoyAr, motivo: 'Harness publico' }, token, slug: SLUG,
    });
    const pub = await req('GET', `/api/negocios/publico/${SLUG}`);
    chk('[7] GET /negocios/publico trae horariosAtencion (la grilla)', !!pub.data?.configuracion?.horariosAtencion, trunc(pub.data?.configuracion?.horariosAtencion, 60));
    chk('[7] GET /negocios/publico trae horariosDelivery', !!pub.data?.configuracion?.horariosDelivery, trunc(pub.data?.configuracion?.horariosDelivery, 60));
    chk('[7] GET /negocios/publico trae las excepciones (feriados)', Array.isArray(pub.data?.excepciones) && pub.data.excepciones.length === 1, trunc(pub.data?.excepciones));
    if (excPub.status === 201) await req('DELETE', `/api/horarios/excepciones/${excPub.data.id}`, { token, slug: SLUG });

    // ---------------- [6] REGRESION de los DOS tenants reales (solo lectura) ----------------
    for (const slug of ['que-lomitos', 'bar-la-esquina']) {
      const neg = await prisma.negocio.findFirst({ where: { slug }, select: { id: true, slug: true } });
      const du = await prisma.empleado.findFirst({
        where: { negocioId: neg.id, rol: 'DUENO', activo: true, eliminadoEn: null }, select: { id: true },
      });
      const cfg = await prisma.configuracionClub.findUnique({
        where: { negocioId: neg.id }, select: { horariosAtencion: true, horariosDelivery: true },
      });
      const t = firmarDueno(du.id, neg.id, neg.slug);
      const est = await req('GET', '/api/horarios/estado', { token: t });
      chk(
        `[6] ${slug}: sin horarios => SIN_HORARIOS y abierto`,
        cfg.horariosAtencion === null && est.status === 200 && est.data?.atencion?.abierto === true && est.data?.atencion?.motivo === 'SIN_HORARIOS',
        `status ${est.status} motivo ${est.data?.atencion?.motivo}`,
      );
    }

    // ---------------- resumen ----------------
    console.log(`\n${falla === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} OK / ${falla} FALLA`);
    process.exitCode = falla === 0 ? 0 : 1;
  } catch (e) {
    console.error('\nError inesperado del harness:', e);
    process.exitCode = 1;
  } finally {
    // ---------------- limpieza ----------------
    if (negocioId) {
      await prisma.excepcionHorario.deleteMany({ where: { negocioId } }).catch(() => undefined);
      await prisma.pedido.deleteMany({ where: { negocioId } }).catch(() => undefined);
      await prisma.negocio.delete({ where: { id: negocioId } }).catch((e) => console.error('No se pudo borrar el negocio de prueba:', e.message));
      const quedan = await prisma.negocio.count({ where: { id: negocioId } }).catch(() => -1);
      console.log(`Limpieza: negocio de prueba ${quedan === 0 ? 'borrado' : `QUEDO (${quedan})`}`);
    }
    await prisma.$disconnect();
  }
})();
