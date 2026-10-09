/**
 * Fase 0 + Fase 1: el pedido del menu entra con cliente y se vincula a la visita (una sola vez).
 *
 *   pnpm --filter backend test:visita-pedido
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:visita-pedido
 *
 * Cubre:
 *   [0] POST /pedidos con la COOKIE de cliente guarda `clienteId` (antes: 30/30 invitados).
 *       Control negativo: sin cookie, sigue siendo invitado.
 *   [1] GET /visitas/validar/:token devuelve el pedido como candidato (por clienteId) y
 *       POST /visitas/aprobar/:token { pedidoId } usa el TOTAL del pedido como monto.
 *   [2] Candado anti doble acreditacion: entregar ese pedido NO vuelve a acreditar.
 *
 * Telefono unico por corrida (es la identidad del cliente). Todo lo creado se borra al final.
 */
const { PrismaClient } = require('@prisma/client');

const API = process.env.API_URL || 'https://api.clubio.lat';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';
const PIN = process.env.STAFF_PIN || '1111';
const prisma = new PrismaClient();

let ok = 0, falla = 0;
const chk = (etiqueta, cond, extra = '') => {
  if (cond) { ok++; console.log(`  OK    ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
  else { falla++; console.log(`  FALLA ${etiqueta}${extra ? '   -> ' + extra : ''}`); }
};
const trunc = (v, n = 170) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

async function req(method, path, { body, token, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  const crudas = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const setCookie = [...crudas, res.headers.get('set-cookie') ?? ''].filter(Boolean).join(' | ');
  return { status: res.status, data, setCookie };
}
const cookieDe = (setCookie) =>
  String(setCookie).split('|').map((c) => c.trim().split(';')[0]).filter((c) => c.startsWith('cliente_token=')).join('; ');

/**
 * OJO: solo objetos que PARECEN un item de carta (con `precio` numerico). Sin ese filtro,
 * el `negocio` de la respuesta (que tambien trae `nombre` + `id`) se colaba como item y el
 * POST /pedidos moria con "Item inexistente".
 */
function buscarItem(obj, acc = []) {
  if (obj && typeof obj === 'object') {
    if (obj.nombre && (obj.id || obj.itemId) && typeof obj.precio === 'number') {
      acc.push({ id: obj.id || obj.itemId, nombre: obj.nombre });
    }
    for (const v of Object.values(obj)) buscarItem(v, acc);
  }
  return acc;
}

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);
  const tel = `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
  const tel2 = `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}1`;
  let clienteId = null, pedidoId = null, visitaId = null, linkToken = null;

  const limpiar = async () => {
    try {
      // Defensivo: si el telefono que mandamos no esta ya en E.164, el backend lo normaliza antes
      // de guardarlo y el crudo no matchearia. Se borra por las dos formas.
      const tels = [tel, tel2];
      for (const t of [tel, tel2]) {
        try { const n = require('../dist/common/utils/phone.util.js').normalizarTelefonoE164(t); if (n) tels.push(n); } catch {}
      }
      if (clienteId) {
        await prisma.visita.deleteMany({ where: { clienteId } });
        await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId } });
        await prisma.tokenValidacion.deleteMany({ where: { clienteId } });
        await prisma.pedido.deleteMany({ where: { clienteId } });
        await prisma.cliente.deleteMany({ where: { id: clienteId } });
      }
      await prisma.pedido.deleteMany({ where: { telefono: { in: tels } } });
      await prisma.cliente.deleteMany({ where: { telefono: { in: tels } } });
    } catch (e) { console.log('  (cleanup parcial: ' + e.message.split('\n')[0] + ')'); }
  };

  try {
    const negocio = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true } });
    if (!negocio) { console.log('No encontre el negocio ' + SLUG); process.exit(2); }
    const cfg = await prisma.configuracionClub.findUnique({
      where: { negocioId: negocio.id },
      select: { modoFidelizacion: true, puntosPorMil: true, modoClientesNegocio: true },
    }).catch(() => null) ?? await prisma.configuracionClub.findUnique({
      where: { negocioId: negocio.id }, select: { modoFidelizacion: true, puntosPorMil: true },
    });
    const neg = await prisma.negocio.findUnique({ where: { id: negocio.id }, select: { modoClientes: true } });
    const porSucursal = neg?.modoClientes === 'POR_SUCURSAL';
    const calcular = (monto) => Math.floor((monto / 1000) * (cfg?.puntosPorMil ?? 5));
    console.log(`config: modo=${cfg?.modoFidelizacion} tasa=${cfg?.puntosPorMil} modoClientes=${neg?.modoClientes}\n`);

    const staff = await req('POST', '/api/auth/empleado/login', { body: { negocioSlug: SLUG, pin: PIN } });
    const staffToken = staff.data?.accessToken;
    if (!staffToken) { console.log('SIN TOKEN DE STAFF: ' + trunc(staff.data)); process.exit(2); }

    const carta = await req('GET', '/api/carta?sucursalSlug=centro');
    const items = buscarItem(carta.data);
    const item = items.find((i) => /coca/i.test(i.nombre)) ?? items[0];
    if (!item) { console.log('No encontre un item de carta (items vistos: ' + items.length + ')'); process.exit(2); }
    console.log(`item de la carta: ${item.nombre}\n`);

    // ---------------------------------------------------------------- [0] Fase 0
    console.log('[0] Fase 0: el pedido guarda el cliente de la COOKIE');
    const reg = await req('POST', '/api/auth/cliente/registrar', {
      body: { nombre: 'Harness Vinculo', telefono: tel, negocioSlug: SLUG },
    });
    chk('registro de cliente -> 2xx', reg.status >= 200 && reg.status < 300, `status=${reg.status} ${trunc(reg.data)}`);
    const cookie = cookieDe(reg.setCookie);
    chk('el registro dejo la cookie cliente_token', cookie.startsWith('cliente_token='), trunc(cookie, 60));
    const cliente = await prisma.cliente.findFirst({ where: { telefono: tel }, select: { id: true } });
    clienteId = cliente?.id ?? null;
    chk('el cliente existe en la DB', !!clienteId, String(clienteId));

    const pedConCookie = await req('POST', '/api/pedidos', {
      cookie,
      body: { tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', nombreCliente: 'Harness Vinculo', telefono: tel, items: [{ itemId: item.id, cantidad: 1 }] },
    });
    chk('POST /pedidos con cookie -> 201', pedConCookie.status === 201, `status=${pedConCookie.status} ${trunc(pedConCookie.data)}`);
    pedidoId = pedConCookie.data?.pedidoId ?? null;
    linkToken = pedConCookie.data?.linkToken ?? null;
    const totalPedido = Number(pedConCookie.data?.total ?? 0);
    const enDb = await prisma.pedido.findUnique({ where: { id: pedidoId ?? '' }, select: { clienteId: true, total: true, telefono: true } });
    chk('el pedido quedo CON clienteId (Fase 0)', !!enDb?.clienteId && enDb.clienteId === clienteId, `clienteId=${enDb?.clienteId}`);
    chk('el total del pedido llego bien', totalPedido > 0 && Number(enDb?.total) === totalPedido, `total=${totalPedido}`);
    const invitado = await req('POST', '/api/pedidos', {
      body: { tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', nombreCliente: 'Harness Guest', telefono: tel2, items: [{ itemId: item.id, cantidad: 1 }] },
    });
    const dbGuest = await prisma.pedido.findFirst({ where: { telefono: tel2 }, select: { clienteId: true } });
    chk('control: sin cookie sigue siendo invitado', invitado.status === 201 && dbGuest?.clienteId === null, `status=${invitado.status} clienteId=${dbGuest?.clienteId}`);

    // ---------------------------------------------------------------- [1] Fase 1
    console.log('\n[1] Fase 1: validar ofrece el pedido y aprobar lo usa como monto');
    const sol = await req('POST', '/api/visitas/solicitar', { cookie, body: {} });
    chk('solicitar visita -> 2xx', sol.status >= 200 && sol.status < 300, `status=${sol.status} ${trunc(sol.data)}`);
    const tokenVisita = sol.data?.token;
    const val = await req('GET', `/api/visitas/validar/${tokenVisita}`, { token: staffToken });
    chk('validar -> 200', val.status === 200, `status=${val.status}`);
    const cands = val.data?.pedidosCandidatos ?? [];
    chk('validar devuelve pedidosCandidatos', Array.isArray(cands), trunc(cands));
    const cand = cands.find((c) => c.id === pedidoId);
    chk('el pedido aparece como candidato (por clienteId)', !!cand, cand ? `total=${cand.total} porTelefono=${cand.porTelefono}` : 'no aparecio');
    chk('el candidato NO viene marcado como "por telefono"', cand && cand.porTelefono === false, String(cand?.porTelefono));

    const ap = await req('POST', `/api/visitas/aprobar/${tokenVisita}`, { token: staffToken, body: { pedidoId } });
    chk('aprobar con pedidoId -> 2xx', ap.status >= 200 && ap.status < 300, `status=${ap.status} ${trunc(ap.data)}`);
    const visita = await prisma.visita.findFirst({
      where: { clienteId }, orderBy: { aprobadoEn: 'desc' },
      select: { id: true, montoConsumido: true, puntosOtorgados: true, sellosOtorgados: true, pedidoId: true, metodo: true },
    });
    visitaId = visita?.id ?? null;
    chk('la visita guardo el vinculo (Visita.pedidoId)', !!pedidoId && visita?.pedidoId === pedidoId, `pedidoId=${visita?.pedidoId} (esperado ${pedidoId})`);
    chk('el monto es el TOTAL del pedido', !!totalPedido && Number(visita?.montoConsumido) === totalPedido, `monto=${Number(visita?.montoConsumido)} total=${totalPedido}`);
    chk('los puntos salen del total (tasa del club)', !!totalPedido && visita?.puntosOtorgados === calcular(totalPedido), `puntos=${visita?.puntosOtorgados} esperado=${calcular(totalPedido)}`);

    // ------------------------------------------------------- [2] candado anti doble
    console.log('\n[2] Candado: entregar el pedido vinculado no acredita de nuevo');
    const cli = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { puntosActuales: true, sellosActuales: true } });
    const tarj = await prisma.tarjetaClienteSucursal.findFirst({ where: { clienteId }, select: { puntosActuales: true, sellosActuales: true } });
    const antes = { cliente: cli, tarjeta: tarj, visitas: await prisma.visita.count({ where: { clienteId } }) };

    for (const estado of ['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']) {
      const paso = await req('PATCH', `/api/pedidos/${pedidoId}/estado`, { token: staffToken, body: { estado } });
      chk(`pedido -> ${estado}`, paso.status >= 200 && paso.status < 300, `status=${paso.status} ${trunc(paso.data, 90)}`);
      if (paso.status >= 300) break;
    }
    const despues = {
      cliente: await prisma.cliente.findUnique({ where: { id: clienteId }, select: { puntosActuales: true, sellosActuales: true } }),
      tarjeta: await prisma.tarjetaClienteSucursal.findFirst({ where: { clienteId }, select: { puntosActuales: true, sellosActuales: true } }),
      visitas: await prisma.visita.count({ where: { clienteId } }),
    };
    chk('no se creo una segunda visita por el pedido', despues.visitas === antes.visitas, `${antes.visitas} -> ${despues.visitas}`);
    chk('el cliente NO sumo puntos de nuevo', despues.cliente?.puntosActuales === antes.cliente?.puntosActuales, `${antes.cliente?.puntosActuales} -> ${despues.cliente?.puntosActuales}`);
    chk('el cliente NO sumo sellos de nuevo', despues.cliente?.sellosActuales === antes.cliente?.sellosActuales, `${antes.cliente?.sellosActuales} -> ${despues.cliente?.sellosActuales}`);
    chk('la tarjeta de la sucursal tampoco se movio', despues.tarjeta?.puntosActuales === antes.tarjeta?.puntosActuales, `${antes.tarjeta?.puntosActuales} -> ${despues.tarjeta?.puntosActuales}`);
  } catch (e) {
    falla++;
    console.log('\nEXCEPCION: ' + (e && e.message ? e.message.split('\n')[0] : String(e)));
    if (e && e.stack) console.log(e.stack.split('\n').slice(0, 6).join('\n'));
    else if (e) console.log('crudo: ' + JSON.stringify(e));
  } finally {
    await limpiar();
    await prisma.$disconnect();
    console.log('\ncleanup: cliente, pedidos, visitas y tokens de la corrida borrados');
    console.log(`TOTAL: ${ok} OK, ${falla} FALLA`);
    console.log(falla === 0 ? 'TOTAL OK' : 'TOTAL FALLA');
    process.exit(falla === 0 ? 0 : 1);
  }
})();
