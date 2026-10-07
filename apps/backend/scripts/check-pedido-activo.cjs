/**
 * Un pedido ACTIVO por cliente (hibrido: `clienteId` con sesion, telefono normalizado sin sesion).
 *
 * Vigila que `POST /pedidos` rechace con 409 cuando el cliente ya tiene un pedido en
 * PENDIENTE/CONFIRMADO/EN_PREPARACION/LISTO/ENVIADO, que el payload traiga el linkToken del
 * pedido en curso (es lo que el checkout usa para ofrecer "ver mi pedido" / "cancelarlo") y que
 * al cancelarlo se pueda volver a pedir.
 *
 *   pnpm --filter backend test:pedido-activo                                   (localhost:3000)
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:pedido-activo
 *
 * Telefono unico por corrida a proposito: es la identidad del guest, asi que un numero fijo
 * haria chocar la segunda corrida con el limite que el propio harness esta probando.
 * Todo lo creado se cancela en un `finally`.
 */
const API = process.env.API_URL || 'http://localhost:3000';
const SLUG = process.env.TENANT_SLUG || 'bar-la-esquina';

let fallos = 0;
function chk(etiqueta, cond, extra = '') {
  console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${etiqueta}${extra ? '   -> ' + extra : ''}`);
  if (!cond) fallos += 1;
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG };
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

(async () => {
  console.log(`API: ${API}   tenant: ${SLUG}\n`);

  const carta = await req('GET', '/api/carta?sucursalSlug=centro');
  const coca = buscarItem(carta.data, []).find((i) => /coca/i.test(i.nombre));
  if (!coca) { console.log('No encontre un item de la carta.'); process.exit(2); }
  // Sufijo unico: el telefono ES la identidad del guest.
  const tel = `+54911${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
  console.log(`item: ${coca.nombre}\ntelefono de la corrida: ${tel}\n`);

  const crear = (nombre) => req('POST', '/api/pedidos', {
    tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', nombreCliente: nombre, telefono: tel,
    items: [{ itemId: coca.id, cantidad: 1 }],
  });
  const cancelar = (linkToken) => req('POST', `/api/pedidos/publico/${linkToken}/cancelar`);

  const creados = new Set();
  try {
    // 1) el primero entra
    const a = await crear('Harness Activo 1');
    chk('primer pedido -> 201', a.status === 201, `status=${a.status}`);
    if (a.data?.linkToken) creados.add(a.data.linkToken);

    // 2) el segundo (mismo telefono) choca
    const b = await crear('Harness Activo 2');
    chk('segundo pedido con el MISMO telefono -> 409', b.status === 409, `status=${b.status}`);
    chk('el 409 explica', /ya tenes un pedido activo/i.test(String(b.data?.message ?? '')),
      JSON.stringify(b.data?.message));
    chk('el 409 trae el linkToken del pedido ACTIVO', b.data?.linkToken === a.data?.linkToken,
      b.data?.linkToken === a.data?.linkToken ? 'igual al del primero' : JSON.stringify(b.data?.linkToken));
    chk('el 409 trae pedidoId y estado', b.data?.pedidoId === a.data?.pedidoId && b.data?.estado === 'PENDIENTE',
      `pedidoId=${b.data?.pedidoId === a.data?.pedidoId ? 'el del primero' : JSON.stringify(b.data?.pedidoId)} estado=${b.data?.estado}`);
    chk('no se creo un segundo pedido', b.data?.pedidoId !== undefined && b.status === 409);

    // 3) cancelado el activo, se puede volver a pedir
    if (a.data?.linkToken) {
      const cancel = await cancelar(a.data.linkToken);
      chk('cancelar el activo -> 200/201', cancel.status === 200 || cancel.status === 201,
        `status=${cancel.status} ${cancel.data?.estado}`);
      creados.delete(a.data.linkToken); // ya cancelado en el flujo: no hace falta en la limpieza
    }
    const c = await crear('Harness Activo 3');
    chk('con el activo cancelado, se puede crear otro -> 201', c.status === 201,
      `status=${c.status} ${JSON.stringify(c.data?.message ?? '')}`);
    if (c.data?.linkToken) creados.add(c.data.linkToken);
  } finally {
    const limpiezas = [];
    for (const t of creados) {
      const r = await cancelar(t).catch(() => ({ status: 'ERR' }));
      limpiezas.push(`${String(t).slice(0, 6)}…=${r.status}`);
    }
    console.log(`\n  limpieza: ${limpiezas.length ? limpiezas.join('  ') : 'nada que limpiar'}`);
  }

  console.log(`\nTOTAL: ${fallos === 0 ? 'OK' : fallos + ' FALLA(S)'}`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.log('ERROR:', e && e.message ? e.message : e); process.exit(1); });
