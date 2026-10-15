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
 *  [10] MIS PREMIOS (el listado de `GET /visitas/mi-tarjeta` -> bloque "Tus premios ganados"):
 *      varios premios del mismo cliente con distintos tipos/estados, AISLAMIENTO entre clientes,
 *      VENCIDO COMPUTADO (fila PENDIENTE con `expiraEn` pasado, sin que el GET la escriba) y —
 *      el caso grave— un premio LIBRE ACEPTADO que se recupera del listado con su link de canje
 *      despues de "cerrar la modal" (nadie lee la respuesta del aceptar).
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
/** Segundo cliente (solo para el aislamiento del listado): otro telefono, mismo negocio. */
const TEL_AISLADO = `+5****01${RUN.slice(-6).padEnd(6, '0')}`;

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

    // ==========================================================================
    // [10] MIS PREMIOS: el listado de premios del cliente (GET /visitas/mi-tarjeta)
    // ==========================================================================
    console.log('\n[10] MIS PREMIOS: listado, aislamiento, vencido computado y el premio LIBRE recuperado');
    const secretCliente = process.env.JWT_CLIENTE_SECRET;
    if (!secretCliente) throw new Error('Falta JWT_CLIENTE_SECRET en el entorno');
    const jwtCliente = (clienteId) =>
      jwt.sign({ sub: clienteId, tipo: 'cliente', negocioId, negocioSlug: SLUG }, secretCliente, { expiresIn: '1h' });
    const tokenCli = jwtCliente(cliente.id);

    // Un premio por ESTADO/tipo, todos del MISMO cliente. Se crean directo en la DB: lo que se
    // prueba aca es el LISTADO (el flujo de otorgar ya se probo en [1] y [4]).
    const mkPremio = (clienteId, data) =>
      prisma.premioOtorgado.create({ data: { negocioId, clienteId, ...data } });

    const pPend = await mkPremio(cliente.id, {
      tipo: 'SELLOS', cantidad: 2, texto: `2 sellos ${RUN}`, token: `test-mios-sellos-${RUN}`, estado: 'PENDIENTE',
    });
    premios.push(pPend.id);
    const pLibreNuevo = await mkPremio(cliente.id, {
      tipo: 'LIBRE', cantidad: 0, texto: `un postre gratis ${RUN}`, token: `test-mios-libre-${RUN}`, estado: 'PENDIENTE',
    });
    premios.push(pLibreNuevo.id);
    // PENDIENTE con `expiraEn` YA PASADO: nadie lo persistio como VENCIDO (solo se escribe al
    // intentar aceptar). El listado TIENE que devolverlo VENCIDO igual.
    const pVencidoPend = await mkPremio(cliente.id, {
      tipo: 'SELLOS', cantidad: 5, texto: `vencido sin persistir ${RUN}`, token: `test-mios-vencido-${RUN}`,
      estado: 'PENDIENTE', expiraEn: new Date(Date.now() - 3_600_000),
    });
    premios.push(pVencidoPend.id);
    const pCanjeado = await mkPremio(cliente.id, {
      tipo: 'PUNTOS', cantidad: 50, texto: `50 puntos ${RUN}`, token: `test-mios-canjeado-${RUN}`,
      estado: 'CANJEADO', aceptadoEn: new Date(Date.now() - 7_200_000), canjeadoEn: new Date(Date.now() - 3_600_000),
    });
    premios.push(pCanjeado.id);
    // Premio ACEPTADO de otro cliente del MISMO negocio: sirve para el aislamiento.
    const cliente2 = await prisma.cliente.create({
      data: { negocioId, nombre: `TEST mios aislado ${RUN}`, telefono: TEL_AISLADO, aceptaNotificaciones: false, sellosActuales: 0 },
    });
    clientes.push(cliente2.id);
    const pAjeno = await mkPremio(cliente2.id, {
      tipo: 'SELLOS', cantidad: 9, texto: `ajeno ${RUN}`, token: `test-mios-ajeno-${RUN}`, estado: 'ACEPTADO',
      aceptadoEn: new Date(),
    });
    premios.push(pAjeno.id);

    const lista1 = await req('GET', '/api/visitas/mi-tarjeta', { token: tokenCli });
    chk('[10.1] GET /visitas/mi-tarjeta con JWT de cliente responde 200', lista1.status === 200, `status=${lista1.status}`);
    const mis = Array.isArray(lista1.data?.premios) ? lista1.data.premios : null;
    chk('[10.1] la tarjeta trae `premios[]` (el listado no es un request aparte)', Array.isArray(mis), trunc(lista1.data?.premios));
    const tokens = new Set((mis ?? []).map((p) => p.token));
    chk('[10.1] el listado devuelve VARIOS premios distintos del mismo cliente (uno por estado/tipo)',
      tokens.has(pPend.token) && tokens.has(pLibreNuevo.token) && tokens.has(pVencidoPend.token) && tokens.has(pCanjeado.token),
      `n=${(mis ?? []).length} total=${lista1.data?.premiosTotal}`);
    chk('[10.1] `premiosTotal` cuenta TODOS los premios del cliente (el array viene capado)',
      lista1.data?.premiosTotal >= 4 && (mis ?? []).length <= 20, `total=${lista1.data?.premiosTotal} mostrados=${(mis ?? []).length}`);
    chk('[10.1] el LIBRE pendiente viene PENDIENTE y SIN mecanismo de canje (todavia no hay nada que verificar)',
      mis?.find((p) => p.token === pLibreNuevo.token)?.estado === 'PENDIENTE'
      && mis?.find((p) => p.token === pLibreNuevo.token)?.verificacion === null);

    // ORDEN por relevancia: lo accionable primero (PENDIENTE -> ACEPTADO -> CANJEADO -> VENCIDO).
    const pos = (t) => (mis ?? []).findIndex((p) => p.token === t);
    const estados = (mis ?? []).map((p) => p.estado);
    const primerVencido = estados.indexOf('VENCIDO');
    chk('[10.1] el orden pone lo PENDIENTE primero, el historial despues y TODO lo vencido al final',
      estados[0] === 'PENDIENTE' && primerVencido > 0 && estados.slice(primerVencido).every((e) => e === 'VENCIDO'),
      estados.join(' > '));
    chk('[10.1] entre los no accionables, CANJEADO va ANTES que VENCIDO',
      pos(pCanjeado.token) < pos(pVencidoPend.token), `canjeado=${pos(pCanjeado.token)} vencido=${pos(pVencidoPend.token)}`);

    console.log('\n[10.2] AISLAMIENTO: otro cliente NO ve estos premios');
    const listaAjeno = await req('GET', '/api/visitas/mi-tarjeta', { token: jwtCliente(cliente2.id) });
    chk('[10.2] el otro cliente ve su propia tarjeta', listaAjeno.status === 200, `status=${listaAjeno.status}`);
    const tokensAjenos = new Set((listaAjeno.data?.premios ?? []).map((p) => p.token));
    chk('[10.2] el cliente 2 NO ve ninguno de los premios del cliente 1',
      ![pPend.token, pLibreNuevo.token, pVencidoPend.token, pCanjeado.token].some((t) => tokensAjenos.has(t)),
      `ajenos=${tokensAjenos.size}`);
    chk('[10.2] el cliente 2 SI ve su propio premio', tokensAjenos.has(pAjeno.token));
    chk('[10.2] el cliente 1 NO ve el premio del cliente 2', !tokens.has(pAjeno.token));
    const listaSinAuth = await req('GET', '/api/visitas/mi-tarjeta');
    chk('[10.2] sin sesion de cliente no hay listado (401)', listaSinAuth.status === 401, `status=${listaSinAuth.status}`);

    console.log('\n[10.3] VENCIDO COMPUTADO: fila PENDIENTE con `expiraEn` pasado -> VENCIDO (la DB no se toca)');
    const vencidoEnLista = mis?.find((p) => p.token === pVencidoPend.token);
    chk('[10.3] el listado lo devuelve VENCIDO aunque la fila diga PENDIENTE', vencidoEnLista?.estado === 'VENCIDO', trunc(vencidoEnLista && { estado: vencidoEnLista.estado, expiraLegible: vencidoEnLista.expiraLegible }));
    chk('[10.3] trae el vencimiento legible para el aviso de la tarjeta', typeof vencidoEnLista?.expiraLegible === 'string' && vencidoEnLista.expiraLegible.length > 0, trunc(vencidoEnLista?.expiraLegible));
    chk('[10.3] un VENCIDO no ofrece mecanismo de canje', vencidoEnLista?.verificacion === null);
    const filaVencida = await prisma.premioOtorgado.findUnique({ where: { id: pVencidoPend.id }, select: { estado: true } });
    chk('[10.3] el GET NO escribio en la DB: la fila sigue PENDIENTE', filaVencida?.estado === 'PENDIENTE', `estado=${filaVencida?.estado}`);
    const rAcepVenc = await req('POST', `/api/premios/${pVencidoPend.token}/aceptar`);
    chk('[10.3] y aceptarlo sigue siendo imposible (el estado esta computado, no inventado)',
      rAcepVenc.data?.ok === false && rAcepVenc.data?.motivo === 'vencido', trunc(rAcepVenc.data && { ok: rAcepVenc.data.ok, motivo: rAcepVenc.data.motivo }));

    console.log('\n[10.4] ACEPTADO/CANJEADO traen el mecanismo de canje (link del staff + WhatsApp)');
    const pAceptadoReal = await mkPremio(cliente.id, {
      tipo: 'PUNTOS', cantidad: 50, texto: `50 puntos aceptado ${RUN}`, token: `test-mios-aceptado-${RUN}`,
      estado: 'ACEPTADO', aceptadoEn: new Date(),
    });
    premios.push(pAceptadoReal.id);
    const lista2 = await req('GET', '/api/visitas/mi-tarjeta', { token: tokenCli });
    const aceptadoEnLista = (lista2.data?.premios ?? []).find((p) => p.token === pAceptadoReal.token);
    chk('[10.4] el ACEPTADO trae `verificacion.url` (link del staff, absoluto y con el token)',
      !!aceptadoEnLista?.verificacion?.url
      && aceptadoEnLista.verificacion.url.startsWith('https://')
      && aceptadoEnLista.verificacion.url.includes('/validar-premio?ref=')
      && aceptadoEnLista.verificacion.url.includes(pAceptadoReal.token),
      trunc(aceptadoEnLista?.verificacion?.url));
    chk('[10.4] el ACEPTADO trae el WhatsApp al numero de atencion del local',
      typeof aceptadoEnLista?.verificacion?.whatsapp === 'string' && aceptadoEnLista.verificacion.whatsapp.startsWith('https://wa.me/'),
      trunc(aceptadoEnLista?.verificacion?.whatsapp));
    chk('[10.4] el mensaje de WhatsApp incluye el link de verificacion',
      typeof aceptadoEnLista?.verificacion?.mensaje === 'string'
      && aceptadoEnLista.verificacion.mensaje.includes(aceptadoEnLista.verificacion.url),
      trunc(aceptadoEnLista?.verificacion?.mensaje));
    const canjeadoEnLista = (lista2.data?.premios ?? []).find((p) => p.token === pCanjeado.token);
    chk('[10.4] el CANJEADO tambien trae su verificacion (comprobante del historial) y su fecha',
      !!canjeadoEnLista?.verificacion?.url && !!canjeadoEnLista?.canjeadoEn, trunc(canjeadoEnLista && { estado: canjeadoEnLista.estado, canjeadoEn: canjeadoEnLista.canjeadoEn }));

    console.log('\n[10.5] EL CASO GRAVE: el LIBRE aceptado (modal cerrada) se recupera desde el listado');
    // Se acepta por token —exactamente el llamado del boton "Aceptar" de la tarjeta— y NO se lee la
    // respuesta: lo unico que queda es el listado, como si el cliente hubiera cerrado la modal o
    // descartado el push.
    const rAcepLibre = await req('POST', `/api/premios/${pLibreNuevo.token}/aceptar`);
    chk('[10.5] el LIBRE se acepta (200) y NO mueve saldo',
      (rAcepLibre.status === 200 || rAcepLibre.status === 201) && rAcepLibre.data?.acreditado?.sellos === 0 && rAcepLibre.data?.acreditado?.puntos === 0,
      trunc(rAcepLibre.data?.acreditado));
    const lista3 = await req('GET', '/api/visitas/mi-tarjeta', { token: tokenCli });
    const libreRecuperado = (lista3.data?.premios ?? []).find((p) => p.token === pLibreNuevo.token);
    chk('[10.5] el LIBRE aparece ACEPTADO en la tarjeta', libreRecuperado?.estado === 'ACEPTADO', trunc(libreRecuperado?.estado));
    chk('[10.5] su LINK DE CANJE se recupera del listado (esto es el fix del premio perdido)',
      !!libreRecuperado?.verificacion?.url && libreRecuperado.verificacion.url.includes(pLibreNuevo.token),
      trunc(libreRecuperado?.verificacion?.url));
    chk('[10.5] y el WhatsApp para avisarle al local tambien',
      typeof libreRecuperado?.verificacion?.whatsapp === 'string' && libreRecuperado.verificacion.whatsapp.startsWith('https://wa.me/'),
      trunc(libreRecuperado?.verificacion?.whatsapp));
    // El link recuperado tiene que ser el MISMO que usa el staff para canjear de verdad.
    const verifStaff = await req('GET', `/api/premios/${pLibreNuevo.token}/verificacion`);
    chk('[10.5] el link recuperado apunta al premio ACEPTADO y canjeable por el staff',
      verifStaff.data?.canjeable === true && verifStaff.data?.estado === 'ACEPTADO',
      trunc(verifStaff.data && { estado: verifStaff.data.estado, canjeable: verifStaff.data.canjeable }));
    const rCanjeLibre = await req('POST', `/api/premios/${pLibreNuevo.token}/canjear`, { token: staffToken });
    chk('[10.5] el local lo marca CANJEADO con ese link (el premio deja de estar perdido)',
      rCanjeLibre.data?.estado === 'CANJEADO', trunc(rCanjeLibre.data && { estado: rCanjeLibre.data.estado, ok: rCanjeLibre.data.ok }));
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
