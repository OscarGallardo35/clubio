/**
 * Verificacion end-to-end de los PREMIOS que el cliente ACEPTA desde la notificacion
 * (auto-verificable).
 *
 *   pnpm --filter backend test:premios-push
 *   API_URL=https://api.clubio.lat pnpm --filter backend test:premios-push
 *
 * Corre contra PROD (API + DB). Cubre el CICLO COMPLETO:
 *  [1] Otorgar: un disparo con `premio` deja el premio PENDIENTE y NO toca el saldo.
 *  [2] Aceptar por token (publico) acredita el saldo UNA sola vez, con la logica del club.
 *  [3] Segundo aceptar NO vuelve a acreditar (claim atomico).
 *  [4] Un premio LIBRE no mueve saldo (lo cierra el canje).
 *  [5] El link de verificacion funciona y el STAFF lo marca CANJEADO.
 *  [6] Un premio VENCIDO no se puede aceptar.
 *  [7] (estatico) El `tag` de la notificacion llega al payload del push (bug real: se
 *      descartaba y todas las push del cliente se colapsaban sin re-alertar).
 *
 * NO se crea NINGUNA suscripcion push: el flujo del premio no depende del push y asi no
 * se le manda nada a ningun cliente real. Todo lo creado se borra en el `finally`.
 */
const fs = require('fs');
const path = require('path');
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
const trunc = (v, n = 160) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n);

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

const RUN = `${Date.now().toString(36)}`;
const TEL = `+5****00${RUN.slice(-6).padEnd(6, '0')}`;

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

  const cfg = await prisma.configuracionClub.findUnique({
    where: { negocioId }, select: { modoFidelizacion: true },
  });
  const modo = cfg?.modoFidelizacion ?? 'SOLO_VISITAS';
  /** GLOBAL vs POR_SUCURSAL: decide DONDE vive el saldo efectivo que devuelve `saldo.antes/despues`. */
  const negocioCompleto = await prisma.negocio.findUnique({
    where: { id: negocioId }, select: { modoClientes: true },
  });
  const modoClientes = negocioCompleto?.modoClientes ?? 'GLOBAL';
  console.log(`\n== Premios push :: ${SLUG} :: run ${RUN} :: ${API} :: modo ${modo} / ${modoClientes} ==`);

  const disparos = [];
  const plantillas = [];
  const premios = [];
  const clientes = [];
  const pedidos = [];

  try {
    // ==========================================================================
    console.log('\n[7] ESTATICO: el `tag` de la notificacion llega al payload del push');
    const raiz = path.join(__dirname, '..');
    const pushSvc = fs.readFileSync(path.join(raiz, 'src/push/push.service.ts'), 'utf8');
    const processor = fs.readFileSync(path.join(raiz, 'src/push/push.processor.ts'), 'utf8');
    const disparosSvc = fs.readFileSync(path.join(raiz, 'src/push/disparos.service.ts'), 'utf8');
    const campanasSvc = fs.readFileSync(path.join(raiz, 'src/push/campanas.service.ts'), 'utf8');
    chk('PushJob declara `tag`', /interface PushJob[\s\S]*?\btag\?:\s*string/.test(pushSvc));
    chk('el processor arma el payload con `tag`', /\btag\b/.test(processor) && /\{\s*tag\s*\}/.test(processor));
    chk('el disparo manda `tag: disparo-<id>`', /tag:\s*`disparo-\$\{d\.id\}`/.test(disparosSvc));
    chk('la campana manda `tag: campana-<id>`', /tag:\s*`campana-\$\{c\.campanaId\}`/.test(campanasSvc));

    // ==========================================================================
    // Plantilla + cliente de prueba (SIN suscripcion push: el premio no depende del push).
    const pl = await prisma.plantillaPush.create({
      data: { negocioId, nombre: `TEST premio pl ${RUN}`, titulo: 'Tenés un premio', cuerpo: 'Abrilo en {{negocio}}', url: '/tarjeta', activa: true },
    });
    plantillas.push(pl.id);
    const cliente = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST premio ${RUN}`, telefono: TEL, aceptaNotificaciones: true, sellosActuales: 0, puntosActuales: 0 },
    });
    clientes.push(cliente.id);
    await prisma.tarjetaClienteSucursal.upsert({
      where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id } },
      update: {}, create: { clienteId: cliente.id, sucursalId: sucursal.id },
    });

    const mkPedido = () => prisma.pedido.create({
      data: {
        negocioId, sucursalId: sucursal.id, clienteId: cliente.id,
        nombreCliente: `TEST ${RUN}`, telefono: TEL, tipo: 'TAKEAWAY', modoPago: 'EFECTIVO',
        items: [], subtotal: 1000, total: 1000, estado: 'LISTO',
      },
    });

    // ==========================================================================
    console.log('\n[1] OTORGAR: el disparo con `premio` deja el premio PENDIENTE y NO toca el saldo');
    const dSellos = await prisma.disparoPush.create({
      data: {
        negocioId, nombre: `TEST premio sellos ${RUN}`, tipo: 'COMPRA', activa: true,
        config: { estado: 'ENTREGADO', cadaNCompras: 1 }, plantillaId: pl.id,
        premio: { tipo: 'SELLOS', cantidad: 2, texto: '2 sellos extra' },
      },
    });
    disparos.push(dSellos.id);
    const pedido = await mkPedido(); pedidos.push(pedido.id);

    const s0 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    const r1 = await req('PATCH', `/api/pedidos/${pedido.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    chk('PATCH pedido -> ENTREGADO responde 200', r1.status === 200, `status=${r1.status}`);
    await new Promise((res) => setTimeout(res, 1200));

    const premio = await prisma.premioOtorgado.findFirst({ where: { negocioId, clienteId: cliente.id }, orderBy: { creadoEn: 'desc' } });
    if (premio) premios.push(premio.id);
    chk('se creo un PremioOtorgado PENDIENTE', !!premio && premio.estado === 'PENDIENTE', trunc(premio && { estado: premio.estado, tipo: premio.tipo, cantidad: premio.cantidad }));
    chk('el premio cuelga del disparo (snapshot del nombre)', premio?.disparoId === dSellos.id && !!premio?.disparoNombre, trunc(premio?.disparoNombre));
    chk('el premio tiene token unico', !!premio?.token && premio.token.length >= 20, trunc(premio?.token, 12));

    const visita = await prisma.visita.findFirst({ where: { clienteId: cliente.id, metodo: 'PEDIDO' }, orderBy: { aprobadoEn: 'desc' }, select: { sellosOtorgados: true } });
    const s1 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('el saldo solo subio por la visita base (el premio NO acredita al otorgar)',
      (s1 - s0) === (visita?.sellosOtorgados ?? 0), `antes=${s0} despues=${s1} base=${visita?.sellosOtorgados}`);

    // ==========================================================================
    console.log('\n[2] ACEPTAR por token acredita UNA sola vez');

    /**
     * Saldo EFECTIVO (sellos+puntos) del cliente, con la MISMA regla del backend
     * (`SaldoNotificador.parActual`): POR_SUCURSAL manda la tarjeta; GLOBAL, el cliente. Es el
     * par contra el que se comparan `saldo.antes`/`saldo.despues` de la respuesta.
     */
    const leerSaldo = async () => {
      if (modoClientes === 'POR_SUCURSAL') {
        const t = await prisma.tarjetaClienteSucursal.findUnique({
          where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id } },
          select: { sellosActuales: true, puntosActuales: true },
        });
        return { sellos: t?.sellosActuales ?? 0, puntos: t?.puntosActuales ?? 0 };
      }
      const c = await prisma.cliente.findUnique({
        where: { id: cliente.id }, select: { sellosActuales: true, puntosActuales: true },
      });
      return { sellos: c?.sellosActuales ?? 0, puntos: c?.puntosActuales ?? 0 };
    };

    const gPub = await req('GET', `/api/premios/${premio.token}`);
    chk('GET /premios/:token (publico) responde 200', gPub.status === 200, `status=${gPub.status}`);
    chk('la modal recibe el premio PENDIENTE', gPub.data?.estado === 'PENDIENTE' && gPub.data?.texto === '2 sellos extra', trunc(gPub.data && { estado: gPub.data.estado, texto: gPub.data.texto }));

    const esperadoSellos = modo === 'SOLO_PUNTOS' ? 0 : 2;
    const saldoPrevio = await leerSaldo();
    chk('un premio PENDIENTE devuelve una PROYECCION de saldo (antes -> despues)',
      gPub.data?.saldo?.antes?.sellos === saldoPrevio.sellos
      && gPub.data?.saldo?.despues?.sellos === saldoPrevio.sellos + esperadoSellos,
      `${trunc(gPub.data?.saldo)} (premio acredita ${esperadoSellos})`);

    const rAcep = await req('POST', `/api/premios/${premio.token}/aceptar`);
    chk('POST /premios/:token/aceptar responde 200', rAcep.status === 200 || rAcep.status === 201, `status=${rAcep.status} ${trunc(rAcep.data)}`);
    chk('acredito los sellos del premio (segun el modo del club)', rAcep.data?.acreditado?.sellos === esperadoSellos && rAcep.data?.acreditado?.puntos === 0, trunc(rAcep.data?.acreditado));
    chk('el premio quedo ACEPTADO', rAcep.data?.estado === 'ACEPTADO' && rAcep.data?.yaAceptado === false, trunc(rAcep.data?.estado));
    const urlVer = rAcep.data?.verificacion?.url ?? '';
    chk('devuelve el link de verificacion del staff (absoluto + slug)', /\/que-lomitos\/validar-premio\?ref=/.test(urlVer) && /^https:\/\//.test(urlVer), trunc(urlVer));
    chk('devuelve el boton de WhatsApp al numero de atencion', typeof rAcep.data?.verificacion?.whatsapp === 'string' && rAcep.data.verificacion.whatsapp.startsWith('https://wa.me/'), trunc(rAcep.data?.verificacion?.whatsapp));

    // SALDO ANTES/DESPUES: es lo que la modal muestra para VERIFICAR el cambio.
    const saldoPosterior = await leerSaldo();
    const saldoAcep = rAcep.data?.saldo;
    chk('la respuesta del aceptar trae saldo.antes/saldo.despues',
      !!saldoAcep?.antes && !!saldoAcep?.despues && typeof saldoAcep.antes.sellos === 'number' && typeof saldoAcep.despues.puntos === 'number',
      trunc(saldoAcep));
    chk('saldo.antes es el saldo REAL previo (no un calculo a mano)',
      saldoAcep?.antes?.sellos === saldoPrevio.sellos && saldoAcep?.antes?.puntos === saldoPrevio.puntos,
      `antes=${trunc(saldoAcep?.antes)} esperado=${trunc(saldoPrevio)}`);
    chk('saldo.despues es el saldo REAL que quedo en la base',
      saldoAcep?.despues?.sellos === saldoPosterior.sellos && saldoAcep?.despues?.puntos === saldoPosterior.puntos,
      `despues=${trunc(saldoAcep?.despues)} real=${trunc(saldoPosterior)}`);
    chk('la diferencia del par es EXACTAMENTE lo acreditado',
      saldoAcep?.despues?.sellos - saldoAcep?.antes?.sellos === esperadoSellos
      && saldoAcep?.despues?.puntos - saldoAcep?.antes?.puntos === 0,
      `${saldoAcep?.antes?.sellos}/${saldoAcep?.antes?.puntos} -> ${saldoAcep?.despues?.sellos}/${saldoAcep?.despues?.puntos}`);

    const gPub2 = await req('GET', `/api/premios/${premio.token}`);
    chk('el GET publico de un premio ACEPTADO trae el mecanismo de canje (para recargar la pagina)',
      !!gPub2.data?.verificacion?.url && /\/validar-premio\?ref=/.test(gPub2.data.verificacion.url),
      trunc(gPub2.data?.verificacion?.url));
    chk('al RECARGAR la pagina el GET devuelve el MISMO par registrado (saldoJson)',
      gPub2.data?.saldo?.antes?.sellos === saldoAcep?.antes?.sellos
      && gPub2.data?.saldo?.despues?.sellos === saldoAcep?.despues?.sellos
      && gPub2.data?.saldo?.antes?.puntos === saldoAcep?.antes?.puntos
      && gPub2.data?.saldo?.despues?.puntos === saldoAcep?.despues?.puntos,
      trunc(gPub2.data?.saldo));

    const s2 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('el saldo subio EXACTAMENTE lo acreditado', (s2 - s1) === esperadoSellos, `antes=${s1} despues=${s2} esperado=+${esperadoSellos}`);

    // ==========================================================================
    console.log('\n[3] Segundo aceptar NO acredita de nuevo (claim atomico)');
    const [rAcep2, rAcep3] = await Promise.all([
      req('POST', `/api/premios/${premio.token}/aceptar`),
      req('POST', `/api/premios/${premio.token}/aceptar`),
    ]);
    chk('el segundo aceptar responde OK pero yaAceptado', rAcep2.data?.yaAceptado === true && rAcep2.data?.acreditado?.sellos === 0, trunc(rAcep2.data?.motivo));
    chk('el segundo aceptar NO cambia el `despues` (devuelve el par registrado)',
      rAcep2.data?.saldo?.despues?.sellos === saldoAcep?.despues?.sellos
      && rAcep2.data?.saldo?.despues?.puntos === saldoAcep?.despues?.puntos
      && rAcep3.data?.saldo?.despues?.sellos === saldoAcep?.despues?.sellos,
      `1ro=${trunc(saldoAcep?.despues)} 2do=${trunc(rAcep2.data?.saldo?.despues)}`);
    const s3 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('el saldo NO cambio con los aceptar repetidos', s3 === s2, `${s2} -> ${s3}`);
    const nAceptados = await prisma.eventoAuditoria.count({ where: { negocioId, accion: 'premio.aceptado', clienteId: cliente.id } });
    chk('hay una sola auditoria de aceptacion', nAceptados === 1, `n=${nAceptados} (r3=${rAcep3.status})`);

    console.log('\n[3b] Doble tap CONCURRENTE sobre un premio PENDIENTE: acredita una sola vez');
    const tokenTap = `test-tap-${RUN}`;
    const premioTap = await prisma.premioOtorgado.create({
      data: {
        negocioId, clienteId: cliente.id, tipo: 'SELLOS', cantidad: 3, texto: 'doble tap',
        token: tokenTap, estado: 'PENDIENTE',
      },
    });
    premios.push(premioTap.id);
    const sTap0 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    const [tapA, tapB] = await Promise.all([
      req('POST', `/api/premios/${tokenTap}/aceptar`),
      req('POST', `/api/premios/${tokenTap}/aceptar`),
    ]);
    const tapOk = [tapA, tapB].filter((r) => r.status < 300).length;
    chk('las dos respuestas son 200', tapOk === 2, `status=${tapA.status}/${tapB.status}`);
    const tapAcreditaron = [tapA, tapB].filter((r) => (r.data?.acreditado?.sellos ?? 0) > 0).length;
    const sTap1 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('solo UNA respuesta acredito', tapAcreditaron === 1, `acreditaron=${tapAcreditaron}`);
    chk('el saldo subio exactamente 3 (una vez)', (sTap1 - sTap0) === (modo === 'SOLO_PUNTOS' ? 0 : 3), `${sTap0} -> ${sTap1}`);
    const nTap = await prisma.eventoAuditoria.count({ where: { negocioId, accion: 'premio.aceptado', clienteId: cliente.id, detalle: { path: ['premioId'], equals: premioTap.id } } });
    chk('una sola auditoria para el premio del doble tap', nTap === 1, `n=${nTap}`);

    // ==========================================================================
    console.log('\n[4] Un premio LIBRE no mueve saldo');
    await prisma.disparoPush.update({ where: { id: dSellos.id }, data: { activa: false } });
    const dLibre = await prisma.disparoPush.create({
      data: {
        negocioId, nombre: `TEST premio libre ${RUN}`, tipo: 'COMPRA', activa: true,
        config: { estado: 'ENTREGADO', cadaNCompras: 1 }, plantillaId: pl.id,
        premio: { tipo: 'LIBRE', texto: 'un postre gratis' },
      },
    });
    disparos.push(dLibre.id);
    const pedidoL = await mkPedido(); pedidos.push(pedidoL.id);
    await req('PATCH', `/api/pedidos/${pedidoL.id}/estado`, { token: staffToken, body: { estado: 'ENTREGADO' } });
    await new Promise((res) => setTimeout(res, 1200));
    const premioLibre = await prisma.premioOtorgado.findFirst({ where: { negocioId, clienteId: cliente.id, tipo: 'LIBRE' }, orderBy: { creadoEn: 'desc' } });
    if (premioLibre) premios.push(premioLibre.id);
    chk('se creo el premio LIBRE PENDIENTE', !!premioLibre && premioLibre.estado === 'PENDIENTE' && premioLibre.cantidad === 0, trunc(premioLibre && { estado: premioLibre.estado, cantidad: premioLibre.cantidad }));

    const s4 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true, puntosActuales: true } }));
    const rLibre = await req('POST', `/api/premios/${premioLibre.token}/aceptar`);
    chk('aceptar el LIBRE responde 200', rLibre.status === 200 || rLibre.status === 201, `status=${rLibre.status}`);
    chk('el LIBRE acredita 0 sellos y 0 puntos', rLibre.data?.acreditado?.sellos === 0 && rLibre.data?.acreditado?.puntos === 0, trunc(rLibre.data?.acreditado));
    chk('un premio LIBRE devuelve antes == despues (no inventa un cambio)',
      !!rLibre.data?.saldo?.antes
      && rLibre.data.saldo.antes.sellos === rLibre.data.saldo.despues.sellos
      && rLibre.data.saldo.antes.puntos === rLibre.data.saldo.despues.puntos,
      trunc(rLibre.data?.saldo));
    const s5 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true, puntosActuales: true } }));
    chk('el saldo no cambio con el LIBRE', s5.sellosActuales === s4.sellosActuales && s5.puntosActuales === s4.puntosActuales, `${s4.sellosActuales}/${s4.puntosActuales} -> ${s5.sellosActuales}/${s5.puntosActuales}`);

    // ==========================================================================
    console.log('\n[5] El link de verificacion funciona y el staff lo marca CANJEADO');
    const verif = await req('GET', `/api/premios/${premio.token}/verificacion`);
    chk('GET /premios/:token/verificacion responde 200', verif.status === 200, `status=${verif.status}`);
    chk('la verificacion muestra el premio ACEPTADO y canjeable', verif.data?.estado === 'ACEPTADO' && verif.data?.canjeable === true, trunc(verif.data && { estado: verif.data.estado, canjeable: verif.data.canjeable }));

    const rCanje = await req('POST', `/api/premios/${premio.token}/canjear`, { token: staffToken });
    chk('el staff marca CANJEADO (200)', rCanje.status === 200 || rCanje.status === 201, `status=${rCanje.status} ${trunc(rCanje.data)}`);
    chk('el premio quedo CANJEADO', rCanje.data?.estado === 'CANJEADO' && rCanje.data?.yaCanjeado === false, trunc(rCanje.data?.estado));
    const verif2 = await req('GET', `/api/premios/${premio.token}/verificacion`);
    chk('la verificacion pasa a CANJEADO y ya no canjeable', verif2.data?.estado === 'CANJEADO' && verif2.data?.canjeable === false, trunc(verif2.data && { estado: verif2.data.estado, canjeable: verif2.data.canjeable }));
    const rCanje2 = await req('POST', `/api/premios/${premio.token}/canjear`, { token: staffToken });
    chk('un segundo canje es idempotente (yaCanjeado)', rCanje2.data?.yaCanjeado === true, trunc(rCanje2.data));
    const rCanjeSinAuth = await req('POST', `/api/premios/${premio.token}/canjear`);
    chk('canjear SIN sesion de staff se rechaza (401/403)', rCanjeSinAuth.status === 401 || rCanjeSinAuth.status === 403, `status=${rCanjeSinAuth.status}`);

    // ==========================================================================
    console.log('\n[6] Un premio VENCIDO no se puede aceptar');
    const tokenVenc = `test-vencido-${RUN}`;
    const premioVenc = await prisma.premioOtorgado.create({
      data: {
        negocioId, clienteId: cliente.id, tipo: 'SELLOS', cantidad: 5, texto: 'vencido',
        token: tokenVenc, estado: 'PENDIENTE', expiraEn: new Date(Date.now() - 60_000),
      },
    });
    premios.push(premioVenc.id);
    const s6 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    const rVenc = await req('POST', `/api/premios/${tokenVenc}/aceptar`);
    chk('aceptar un vencido NO es ok', rVenc.data?.ok === false && rVenc.data?.estado === 'VENCIDO', trunc(rVenc.data && { ok: rVenc.data.ok, estado: rVenc.data.estado }));
    const s7 = (await prisma.cliente.findUnique({ where: { id: cliente.id }, select: { sellosActuales: true } })).sellosActuales;
    chk('el vencido no toco el saldo', s7 === s6, `${s6} -> ${s7}`);
    const rVencCanje = await req('POST', `/api/premios/${tokenVenc}/canjear`, { token: staffToken });
    chk('no se puede canjear un vencido (409/400)', rVencCanje.status === 409 || rVencCanje.status === 400, `status=${rVencCanje.status}`);

    // ==========================================================================
    console.log('\n[8] Token inexistente -> 404 (nunca un listado)');
    const r404 = await req('GET', `/api/premios/no-existe-${RUN}`);
    chk('GET /premios/:token inexistente responde 404', r404.status === 404, `status=${r404.status}`);
  } finally {
    console.log('\n[9] LIMPIEZA');
    await prisma.premioOtorgado.deleteMany({ where: { id: { in: premios } } }).catch(() => undefined);
    await prisma.envioPushLog.deleteMany({ where: { negocioId, clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.disparoPushLog.deleteMany({ where: { disparoId: { in: disparos } } }).catch(() => undefined);
    await prisma.disparoPush.deleteMany({ where: { id: { in: disparos } } }).catch(() => undefined);
    await prisma.plantillaPush.deleteMany({ where: { id: { in: plantillas } } }).catch(() => undefined);
    await prisma.visita.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tokenValidacion.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.pedido.deleteMany({ where: { id: { in: pedidos } } }).catch(() => undefined);
    await prisma.notificacionPush.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: clientes } } }).catch(() => undefined);
    await prisma.cliente.deleteMany({ where: { id: { in: clientes } } }).catch(() => undefined);
    await prisma.eventoAuditoria.deleteMany({
      where: { negocioId, clienteId: { in: clientes }, accion: { in: ['premio.aceptado', 'premio.canjeado', 'push.disparo_premio', 'push.disparo_regalo', 'saldo.cambiado'] } },
    }).catch(() => undefined);
    console.log('  limpieza: premios/disparos/plantillas/clientes/pedidos/visitas/auditoria de prueba borrados; sin suscripciones creadas');
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
