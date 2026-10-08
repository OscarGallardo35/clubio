/**
 * Cancelar un pedido con SOLO el linkToken (la puerta de los guest del QR #1).
 *
 * `PATCH /pedidos/:id/cancelar` (cookie) no sirve para esos pedidos: `POST /pedidos` es
 * publico y deja `clienteId = null`, asi que daban 401 (sin sesion) o 403 (ownership).
 *
 *   pnpm --filter backend test:cancelar                                   (localhost:3000)
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:cancelar
 *
 * Necesita `PIN_ENCARGADO` (el script npm carga .env + .env.secrets). Crea pedidos REALES y
 * los deja cancelados; usa telefonos unicos por corrida para no chocar con el limite de
 * "un pedido activo por cliente".
 */
const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const PIN = process.env.PIN_ENCARGADO;

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { status: res.status, data };
}

function buscarItem(obj, acc) {
  if (obj && typeof obj === 'object') {
    if (obj.nombre && (obj.id || obj.itemId)) acc.push({ id: obj.id || obj.itemId, nombre: obj.nombre });
    for (const v of Object.values(obj)) buscarItem(v, acc);
  }
  return acc;
}

async function crearPedido(itemId, sufijo) {
  return req('POST', '/api/pedidos', {
    tipo: 'TAKEAWAY',
    modoPago: 'EFECTIVO',
    nombreCliente: `Harness Cancelar ${sufijo}`,
    // Telefono unico por corrida: con el limite de "un pedido activo" un numero fijo haria
    // fallar la segunda corrida.
    telefono: `+54911${String(Date.now()).slice(-6)}${sufijo}`,
    items: [{ itemId, cantidad: 1 }],
  });
}

(async () => {
  if (!PIN) { console.log('FALTA PIN_ENCARGADO en el entorno.'); process.exit(2); }
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const carta = await req('GET', '/api/carta?sucursalSlug=centro');
  const items = buscarItem(carta.data, []);
  const coca = items.find((i) => /coca/i.test(i.nombre));
  if (!coca) { console.log('No encontre un item de la carta para el pedido.'); process.exit(2); }
  console.log(`item: ${coca.nombre} (${coca.id})\n`);

  const login = await req('POST', '/api/auth/empleado/login', { negocioSlug: SLUG, pin: PIN });
  const staff = login.data?.accessToken;
  chk('login de staff', Boolean(staff), `status=${login.status}`);
  if (!staff) process.exit(2);

  // ---- 1) PENDIENTE -> se cancela con el linkToken ----
  const a = await crearPedido(coca.id, '1');
  chk('pedido PENDIENTE creado', a.status === 201, `status=${a.status}`);
  const tokenA = a.data?.linkToken;

  if (tokenA) {
    const cancel = await req('POST', `/api/pedidos/publico/${tokenA}/cancelar`);
    chk('POST /pedidos/publico/:linkToken/cancelar (PENDIENTE) -> 200', cancel.status === 200 || cancel.status === 201,
      `status=${cancel.status} ${JSON.stringify(cancel.data?.message ?? '')}`);
    chk('devuelve estado CANCELADO', cancel.data?.estado === 'CANCELADO', JSON.stringify(cancel.data));

    const ver = await req('GET', `/api/pedidos/publico/${tokenA}`);
    chk('el pedido quedo CANCELADO (GET publico)', ver.data?.estado === 'CANCELADO', `estado=${ver.data?.estado}`);
  }

  // ---- 1b) un link VENCIDO tambien se puede cancelar -----
  // Es la salida del 409 del checkout: con el pedido activo y el link vencido (>4 h) no se puede
  // SEGUIR el pedido, pero si cancelarlo. El GET publico si da 410 (el vencimiento limita el
  // seguimiento, no la cancelacion).
  const vencido = await crearPedido(coca.id, '3');
  if (vencido.data?.linkToken) {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      await prisma.pedido.update({
        where: { linkToken: vencido.data.linkToken },
        data: { linkExpiraEn: new Date(Date.now() - 3_600_000) },
      });
      const get = await req('GET', `/api/pedidos/publico/${vencido.data.linkToken}`);
      chk('GET publico con el link vencido -> 410', get.status === 410, `status=${get.status}`);

      const cancel = await req('POST', `/api/pedidos/publico/${vencido.data.linkToken}/cancelar`);
      chk('pero CANCELAR con el link vencido -> 200/201', cancel.status === 200 || cancel.status === 201,
        `status=${cancel.status} ${JSON.stringify(cancel.data?.message ?? '')}`);
      chk('quedo CANCELADO', cancel.data?.estado === 'CANCELADO', JSON.stringify(cancel.data));
    } finally {
      await prisma.$disconnect();
    }
  }

  // ---- 2) el link vencido/inexistente no cancela ----
  const trucho = await req('POST', '/api/pedidos/publico/00000000000000000000000000000000/cancelar');
  chk('linkToken inexistente -> 404', trucho.status === 404, `status=${trucho.status}`);

  // ---- 3) EN_PREPARACION -> 400 ----
  const b = await crearPedido(coca.id, '2');
  const idB = b.data?.pedidoId;
  const tokenB = b.data?.linkToken;
  chk('pedido B creado', b.status === 201, `status=${b.status}`);

  if (idB && tokenB) {
    const conf = await req('PATCH', `/api/pedidos/${idB}/estado`, { estado: 'CONFIRMADO' }, staff);
    const prep = await req('PATCH', `/api/pedidos/${idB}/estado`, { estado: 'EN_PREPARACION' }, staff);
    chk('B pasa a CONFIRMADO -> EN_PREPARACION', conf.status === 200 && prep.status === 200,
      `conf=${conf.status} prep=${prep.status}`);

    const tarde = await req('POST', `/api/pedidos/publico/${tokenB}/cancelar`);
    chk('cancelar en EN_PREPARACION -> 400', tarde.status === 400,
      `status=${tarde.status} ${JSON.stringify(tarde.data?.message ?? '')}`);

    // limpieza: el staff lo cancela (EN_PREPARACION -> CANCELADO si es valido)
    const limpieza = await req('PATCH', `/api/pedidos/${idB}/estado`, { estado: 'CANCELADO' }, staff);
    console.log(`\n  limpieza pedido B: ${limpieza.status}`);
  }

  console.log(`\nTOTAL: ${fallos === 0 ? 'OK' : fallos + ' FALLA(S)'}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.log('ERROR:', e && e.message ? e.message : e); process.exit(1); });
