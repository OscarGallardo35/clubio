/**
 * Check de la maquina de estados del carrito (QR #1).
 *
 * Corre en node pelado (sin Vitest, sin jsdom, sin browser):
 *
 *   node scripts/check-carrito.mts
 *
 * Verifica: merge de lineas, precios (base + extras, con redondeo), validacion de
 * modificadores obligatorios, fases, reset por sucursal, reconciliacion contra la
 * carta, guardas del checkout, clasificacion de errores, totalidad e inmutabilidad.
 */
import {
  cantidadTotal,
  claveDeLinea,
  clasificarError,
  deserializarCarrito,
  estadoInicial,
  recortarParaPersistir,
  rehidratar,
  precioUnitario,
  reducerCarrito,
  subtotalItem,
  totalCarrito,
  validarCheckout,
  validarModificadores,
} from '../lib/carrito-maquina.ts'
import type {
  EstadoCarrito,
  EventoCarrito,
  GrupoModificador,
  ItemCarta,
  ModificadorElegido,
} from '../lib/carrito-maquina.ts'

let ok = 0
const fallas: string[] = []

function chk(nombre: string, cond: boolean, detalle = '') {
  if (cond) {
    ok++
    console.log(`  OK    ${nombre}`)
  } else {
    fallas.push(nombre)
    console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`)
  }
}
function igual(nombre: string, real: unknown, esperado: unknown) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

const SUC = 'cmuvjy4e0001qbq7jcfjrmflp'

/** Item de carta con (o sin) grupos de modificadores. */
function item(id: string, nombre: string, precio: number, grupos: GrupoModificador[] = []): ItemCarta {
  return { id, nombre, precio, disponible: true, grupos }
}
function grupo(id: string, nombre: string, extra: { obligatorio?: boolean; min?: number; max?: number; tipo?: GrupoModificador['tipo'] } = {}): GrupoModificador {
  return {
    id,
    nombre,
    tipo: extra.tipo ?? 'UNICA_SELECCION',
    obligatorio: extra.obligatorio ?? false,
    minSelecciones: extra.min ?? 0,
    maxSelecciones: extra.max ?? 1,
    opciones: [
      { id: `${id}-o1`, nombre: 'Opcion 1', precioExtra: 200, disponible: true },
      { id: `${id}-o2`, nombre: 'Opcion 2', precioExtra: 350, disponible: true },
      { id: `${id}-o3`, nombre: 'Opcion 3', precioExtra: 0, disponible: true },
    ],
  }
}
function mods(g: GrupoModificador, ...opcionIds: string[]): ModificadorElegido {
  return {
    grupoId: g.id,
    grupoNombre: g.nombre,
    opciones: g.opciones.filter((o) => opcionIds.includes(o.id)).map((o) => ({ id: o.id, nombre: o.nombre, precioExtra: o.precioExtra })),
  }
}
const PIZZA = item('item-pizza', 'Pizza muzzarella', 8000)
const EMPANADA = item('item-empanada', 'Empanada de carne', 1200)
const GUSTO = grupo('gr-gusto', 'Elegi el gusto', { obligatorio: true, min: 1, max: 1 })
const AGREGADOS = grupo('gr-agregados', 'Agregados', { tipo: 'MULTIPLE_SELECCION', max: 2 })
const CON_MODS = item('item-con-mods', 'Milanesa', 9000, [GUSTO, AGREGADOS])

function base(extra: Partial<EstadoCarrito> = {}): EstadoCarrito {
  return { ...estadoInicial('bar-la-esquina', SUC, 'centro'), ...extra }
}

// --- 1. Agregar, merge y lineas separadas -----------------------------------
console.log('\n== agregar al carrito ==')
let s = base()
s = reducerCarrito(s, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
igual('agregar un item deja la fase en conItems', s.fase, 'conItems')
igual('cantidad total 1', cantidadTotal(s), 1)
s = reducerCarrito(s, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 2, modificadores: [], notas: '' })
igual('el mismo item suma cantidad en vez de duplicar linea', s.items.length, 1)
igual('quedaron 3 unidades', s.items[0].cantidad, 3)
s = reducerCarrito(s, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: 'sin orégano' })
igual('las mismas unidades con otra nota son otra linea', s.items.length, 2)
s = reducerCarrito(s, { tipo: 'AGREGAR_ITEM', item: EMPANADA, cantidad: 1, modificadores: [], notas: '' })
igual('otro item es otra linea', s.items.length, 3)
igual('el carrito no pierde nada', cantidadTotal(s), 5)

// --- 2. Cantidades fuera de rango ------------------------------------------
console.log('\n== cantidades ==')
let q = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 250, modificadores: [], notas: '' })
igual('la cantidad se limita a 99', q.items[0].cantidad, 99)
q = reducerCarrito(q, { tipo: 'CAMBIAR_CANTIDAD', clave: q.items[0].clave, cantidad: 0 })
igual('cantidad 0 saca la linea', q.items.length, 0)
igual('y el carrito vuelve a vacio', q.fase, 'vacio')
let q2 = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 2, modificadores: [], notas: '' })
q2 = reducerCarrito(q2, { tipo: 'CAMBIAR_CANTIDAD', clave: q2.items[0].clave, cantidad: -5 })
igual('cantidad negativa tambien saca la linea', q2.items.length, 0)

// --- 3. Precios --------------------------------------------------------------
console.log('\n== precios ==')
let p = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: CON_MODS, cantidad: 2, modificadores: [mods(GUSTO, 'gr-gusto-o2'), mods(AGREGADOS, 'gr-agregados-o1')], notas: '' })
igual('unitario = base + extras (9000+350+200)', precioUnitario(p.items[0]), 9550)
igual('subtotal = unitario x cantidad', subtotalItem(p.items[0]), 19100)
igual('total del carrito', totalCarrito(p), 19100)
const DEC = item('item-dec', 'Flan', 1000)
let d = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: DEC, cantidad: 1, modificadores: [], notas: '' })
d = reducerCarrito(d, { tipo: 'AGREGAR_ITEM', item: { ...DEC, id: 'item-dec2' }, cantidad: 1, modificadores: [], notas: '' })
igual('sin ruido de punto flotante (1000+0.1+0.1 no da 1000.20000001)', Math.round(totalCarrito(d) * 100) / 100, totalCarrito(d))
let f = base()
f = reducerCarrito(f, { tipo: 'AGREGAR_ITEM', item: { ...DEC, precio: 0.1 }, cantidad: 1, modificadores: [], notas: '' })
f = reducerCarrito(f, { tipo: 'AGREGAR_ITEM', item: { ...DEC, id: 'x', precio: 0.2 }, cantidad: 1, modificadores: [], notas: '' })
igual('0.1 + 0.2 = 0.3', totalCarrito(f), 0.3)

// --- 4. Validacion de modificadores -----------------------------------------
console.log('\n== modificadores obligatorios ==')
igual('falta el grupo obligatorio', validarModificadores([GUSTO], []), ['Elegi Elegi el gusto'])
igual('grupo obligatorio completo', validarModificadores([GUSTO], [mods(GUSTO, 'gr-gusto-o1')]), [])
igual('min no alcanzado', validarModificadores([grupo('g', 'Salsas', { min: 2, max: 3 })], [mods(grupo('g', 'Salsas', { min: 2, max: 3 }), 'g-o1')]).length, 1)
igual('max excedido', validarModificadores([grupo('g', 'Salsas', { max: 1 })], [{ grupoId: 'g', grupoNombre: 'Salsas', opciones: [{ id: 'a', nombre: 'a', precioExtra: 0 }, { id: 'b', nombre: 'b', precioExtra: 0 }] }]).length, 1)
igual('opcional sin elegir no molesta', validarModificadores([AGREGADOS], []), [])
igual('clave: mismo item con distintos modificadores no se mezcla', claveDeLinea('i1', [mods(GUSTO, 'gr-gusto-o1')], '') !== claveDeLinea('i1', [mods(GUSTO, 'gr-gusto-o2')], ''), true)
const dosGrupos = [mods(GUSTO, 'gr-gusto-o1'), mods(AGREGADOS, 'gr-agregados-o1')]
igual('clave estable sin importar el orden de los grupos', claveDeLinea('i1', dosGrupos, ''), claveDeLinea('i1', [...dosGrupos].reverse(), ''))
igual('la clave no cambia por espacios en las notas', claveDeLinea('i1', [], ' sin sal '), claveDeLinea('i1', [], 'sin sal'))

// --- 5. Fases y checkout ----------------------------------------------------
console.log('\n== fases y checkout ==')
let c = base()
c = reducerCarrito(c, { tipo: 'ABRIR_CHECKOUT' })
igual('no se abre el checkout con el carrito vacio', c.fase, 'vacio')
c = reducerCarrito(c, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
c = reducerCarrito(c, { tipo: 'ABRIR_CHECKOUT' })
igual('con items el checkout abre', c.fase, 'checkout')
c = reducerCarrito(c, { tipo: 'CERRAR_CHECKOUT' })
igual('cerrar checkout vuelve a conItems', c.fase, 'conItems')
c = reducerCarrito(c, { tipo: 'QUITAR_ITEM', clave: c.items[0].clave })
igual('si se vacia desde el checkout, la fase no miente', c.fase, 'vacio')

// guardas del envio
let g1 = base()
g1 = reducerCarrito(g1, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
g1 = reducerCarrito(g1, { tipo: 'ABRIR_CHECKOUT' })
igual('sin tipo ni datos no se envia', reducerCarrito(g1, { tipo: 'ENVIAR' }).fase, 'checkout')
const validaciones = validarCheckout(g1)
chk('el checkout reporta tipo, modo de pago, nombre y telefono', !!(validaciones.tipo && validaciones.modoPago && validaciones.nombre && validaciones.telefono), JSON.stringify(validaciones))
let g2 = reducerCarrito(g1, { tipo: 'SET_TIPO', nuevoTipo: 'DELIVERY' })
g2 = reducerCarrito(g2, { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' })
g2 = reducerCarrito(g2, { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'Ana' })
chk('DELIVERY sin direccion no pasa', !!validarCheckout(g2).direccion)
g2 = reducerCarrito(g2, { tipo: 'SET_CLIENTE', campo: 'telefono', valor: '+5491122334455' })
g2 = reducerCarrito(g2, { tipo: 'SET_CLIENTE', campo: 'direccion', valor: 'Av Siempreviva 742' })
chk('con nombre, telefono y direccion pasa', Object.keys(validarCheckout(g2)).length === 0, JSON.stringify(validarCheckout(g2)))
igual('ENVIAR con datos validos pasa a enviando', reducerCarrito(g2, { tipo: 'ENVIAR' }).fase, 'enviando')
const enEnvio = reducerCarrito(g2, { tipo: 'ENVIAR' })
igual('ENVIAR dos veces no hace nada (anti doble tap)', reducerCarrito(enEnvio, { tipo: 'ENVIAR' }), enEnvio)
const soloMesa = reducerCarrito(reducerCarrito(g1, { tipo: 'SET_TIPO', nuevoTipo: 'MESA' }), { tipo: 'SET_TIPO', nuevoTipo: 'TAKEAWAY' })
chk('al cambiar de tipo se limpia la mesa que ya no aplica', soloMesa.cliente.mesa === undefined)
const conDir = reducerCarrito(reducerCarrito(g1, { tipo: 'SET_TIPO', nuevoTipo: 'DELIVERY' }), { tipo: 'SET_CLIENTE', campo: 'direccion', valor: 'Av Siempreviva 742' })
chk('pasar de DELIVERY a TAKEAWAY borra la direccion', reducerCarrito(conDir, { tipo: 'SET_TIPO', nuevoTipo: 'TAKEAWAY' }).cliente.direccion === undefined)

// --- 6. Sucursal y reconciliacion -------------------------------------------
console.log('\n== sucursal y reconciliacion ==')
let su = base()
su = reducerCarrito(su, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 2, modificadores: [], notas: '' })
const misma = reducerCarrito(su, { tipo: 'CAMBIAR_SUCURSAL', sucursalId: SUC, sucursalSlug: 'centro' })
igual('cambiar a la misma sucursal no toca el carrito', misma.items.length, 1)
const otra = reducerCarrito(su, { tipo: 'CAMBIAR_SUCURSAL', sucursalId: 'otra-suc', sucursalSlug: 'norte' })
igual('cambiar de sucursal vacia el carrito (precios con override)', otra.items.length, 0)
igual('y avisa por que', typeof otra.aviso, 'string')
igual('la sucursal nueva queda activa', [otra.sucursalId, otra.sucursalSlug], ['otra-suc', 'norte'])
chk('el aviso se puede descartar', reducerCarrito(otra, { tipo: 'DESCARTAR_AVISO' }).aviso === null)

let rec = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
rec = reducerCarrito(rec, { tipo: 'AGREGAR_ITEM', item: EMPANADA, cantidad: 1, modificadores: [], notas: '' })
const carta = [item('item-pizza', 'Pizza muzzarella', 9500), item('item-empanada', 'Empanada de carne', 1200, [])]
const rec2 = reducerCarrito(rec, { tipo: 'RECONCILIAR', carta })
igual('la reconciliacion toma el precio nuevo (override de sucursal)', rec2.items.find((i) => i.itemId === 'item-pizza')?.precioBase, 9500)
igual('el total refleja el precio nuevo', totalCarrito(rec2), 9500 + 1200)
const rec3 = reducerCarrito(rec, { tipo: 'RECONCILIAR', carta: [{ ...carta[0], disponible: false }, carta[1]] })
igual('un item que se dio de baja sale del carrito', rec3.items.length, 1)
chk('y avisa cual salio', (rec3.aviso ?? '').includes('Pizza'), rec3.aviso ?? '(sin aviso)')

// --- 7. Errores --------------------------------------------------------------
console.log('\n== errores ==')
igual('429 -> mensaje de espera, no tecnico', clasificarError(429, '').codigo, 'RATE_LIMIT')
chk('429 explica que fue por muchos pedidos', clasificarError(429, '').mensaje.includes('Esperá'), clasificarError(429, '').mensaje)
igual('400 -> validacion con el texto del backend', clasificarError(400, 'El item no existe').mensaje, 'El item no existe')
igual('500 -> problema de red/servidor', clasificarError(500, '').codigo, 'RED')
igual('error sin status (fetch fallo) -> RED', clasificarError(0, '').codigo, 'RED')
const err = reducerCarrito(enEnvio, { tipo: 'PEDIDO_ERROR', status: 429, mensaje: '' })
igual('tras un error se vuelve al checkout para poder reintentar', err.fase, 'checkout')
igual('y el error queda en el estado', err.error?.codigo, 'RATE_LIMIT')
chk('REINTENTAR limpia el error', reducerCarrito(err, { tipo: 'REINTENTAR' }).error === null)

// --- 8. Pedido enviado ------------------------------------------------------
console.log('\n== pedido enviado ==')
const listo = reducerCarrito(enEnvio, { tipo: 'PEDIDO_OK', linkToken: 'tok-123' })
igual('quedar en fase enviado', listo.fase, 'enviado')
igual('el carrito se vacia', listo.items.length, 0)
igual('se guarda el linkToken para el seguimiento', listo.pedido?.linkToken, 'tok-123')
igual('los datos del cliente se conservan (para el proximo pedido)', listo.cliente.nombre, 'Ana')

// --- 9. Totalidad e inmutabilidad -------------------------------------------
console.log('\n== totalidad e inmutabilidad ==')
const EVENTOS: EventoCarrito[] = [
  { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' },
  { tipo: 'QUITAR_ITEM', clave: 'nada' },
  { tipo: 'CAMBIAR_CANTIDAD', clave: 'nada', cantidad: 2 },
  { tipo: 'CAMBIAR_NOTAS', clave: 'nada', notas: 'x' },
  { tipo: 'LIMPIAR' },
  { tipo: 'CAMBIAR_SUCURSAL', sucursalId: SUC, sucursalSlug: 'centro' },
  { tipo: 'RECONCILIAR', carta: [] },
  { tipo: 'ABRIR_CHECKOUT' },
  { tipo: 'CERRAR_CHECKOUT' },
  { tipo: 'SET_TIPO', nuevoTipo: 'MESA' },
  { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' },
  { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'X' },
  { tipo: 'UPSELL_PEDIR' },
  { tipo: 'UPSELL_OK', sugerencia: null },
  { tipo: 'UPSELL_ERROR' },
  { tipo: 'ENVIAR' },
  { tipo: 'PEDIDO_OK', linkToken: 't' },
  { tipo: 'PEDIDO_ERROR', status: 400, mensaje: 'x' },
  { tipo: 'REINTENTAR' },
  { tipo: 'DESCARTAR_AVISO' },
]
let totalidadOk = true
for (const e of EVENTOS) {
  const antes = JSON.stringify(base())
  const conItem = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
  const despues = reducerCarrito(conItem, e)
  const camposOk = ['negocioSlug', 'items', 'fase', 'cliente', 'pedido'].every((k) => k in despues)
  if (!camposOk || typeof despues.fase !== 'string') totalidadOk = false
  // inmutabilidad: la entrada no cambia
  if (JSON.stringify(base()) !== antes) totalidadOk = false
}
chk(`todos los eventos (${EVENTOS.length}) devuelven un estado valido y no mutan la entrada`, totalidadOk)
const sinItems = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
chk('el evento desconocido devuelve el mismo estado', reducerCarrito(sinItems, { tipo: 'CUALQUIERA' } as unknown as EventoCarrito) === sinItems)


// --- 10. Persistencia real (refinamiento 5) ---------------------------------
console.log('\n== persistencia ==')
const CART_SLUG = 'bar-la-esquina'
let q1 = base()
q1 = reducerCarrito(q1, { tipo: 'AGREGAR_ITEM', item: CON_MODS, cantidad: 2, modificadores: [mods(GUSTO, 'gr-gusto-o2')], notas: 'sin sal' })
q1 = reducerCarrito(q1, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })

// 1) agregar -> serializar -> deserializar
const guardado = JSON.stringify(recortarParaPersistir(q1))
const vuelta = deserializarCarrito(guardado, CART_SLUG)
chk('serializar y deserializar conserva el carrito', !!vuelta, 'devolvio null')
igual('mismos items', vuelta?.items.length, 2)
igual('mismas cantidades', vuelta?.items.map((i) => i.cantidad), [2, 1])
igual('mismos modificadores', vuelta?.items[0].modificadores[0].opciones.map((o) => o.id), ['gr-gusto-o2'])
igual('mismas notas', vuelta?.items[0].notas, 'sin sal')
igual('mismo total tras el round trip', totalCarrito({ ...q1, ...(vuelta as object) } as never), totalCarrito(q1))
chk('no se persiste el estado de la sesion (error/upsell)', !('error' in (vuelta as object)) && !('upsell' in (vuelta as object)))
chk('`enviando` no se persiste: un cierre en pleno envio vuelve a checkout',
    recortarParaPersistir(reducerCarrito(reducerCarrito(reducerCarrito(reducerCarrito(q1, { tipo: 'ABRIR_CHECKOUT' }), { tipo: 'SET_TIPO', nuevoTipo: 'TAKEAWAY' }), { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' }), { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'A' })).fase !== 'enviando')
chk('localStorage basura no rompe: devuelve null', deserializarCarrito('{no soy json', CART_SLUG) === null)
chk('items con forma invalida se descartan', (deserializarCarrito(JSON.stringify({ items: [{ itemId: 'x' }, { itemId: 'y', precioBase: 1, cantidad: 1, modificadores: [] }] }), CART_SLUG)?.items.length ?? 0) === 1)

// 2) cambiar de sucursal -> se vacia con aviso
const OtraSuc = rehidratar(recortarParaPersistir(q1), { sucursalId: 'suc-norte', sucursalSlug: 'norte' })
igual('carrito de otra sucursal: se vacia', OtraSuc.items.length, 0)
chk('y avisa por que', (OtraSuc.aviso ?? '').includes('sucursal'), OtraSuc.aviso ?? '(sin aviso)')
igual('la sucursal viva manda sobre la guardada', OtraSuc.sucursalId, 'suc-norte')
const MismaSuc = rehidratar(recortarParaPersistir(q1), { sucursalId: SUC, sucursalSlug: 'centro' })
igual('la misma sucursal conserva el carrito', MismaSuc.items.length, 2)

// 3) cambia el precio en la carta -> se reconcilia al rehidratar
const cartaNueva = [item('item-pizza', 'Pizza muzzarella', 9900), item('item-con-mods', 'Milanesa', 9000, [GUSTO, AGREGADOS])]
const recP = rehidratar(recortarParaPersistir(q1), { sucursalId: SUC, sucursalSlug: 'centro', carta: cartaNueva })
igual('toma el precio nuevo de la carta', recP.items.find((i) => i.itemId === 'item-pizza')?.precioBase, 9900)
igual('el total se recalcula', totalCarrito(recP), totalCarrito(q1) + 1900)

// 4) un item que ya no esta en la carta -> se quita con aviso
const recP2 = rehidratar(recortarParaPersistir(q1), { sucursalId: SUC, sucursalSlug: 'centro', carta: [cartaNueva[1]] })
igual('el item que ya no existe sale del carrito', recP2.items.length, 1)
chk('y avisa cual salio', (recP2.aviso ?? '').includes('Pizza'), recP2.aviso ?? '(sin aviso)')

// 5) el pedido enviado sobrevive (para el seguimiento por linkToken)
const enviado = reducerCarrito(reducerCarrito(q1, { tipo: 'ABRIR_CHECKOUT' }), { tipo: 'PEDIDO_OK', linkToken: 'tok-9' })
const reabierto = rehidratar(recortarParaPersistir(enviado), { sucursalId: SUC, sucursalSlug: 'centro' })
igual('al reabrir se puede seguir el pedido', reabierto.pedido?.linkToken, 'tok-9')
igual('y no queda carrito colgado', reabierto.items.length, 0)


// --- Notas generales del pedido (SET_NOTAS_PEDIDO) ---------------------------
console.log('\n== notas del pedido ==')
{
  const base = estadoInicial('bar-la-esquina', 's1', 'centro')
  const largas = reducerCarrito(base, { tipo: 'SET_NOTAS_PEDIDO', notas: 'x'.repeat(700) })
  igual('se truncan a 500 (el maximo del backend)', largas.notasPedido?.length, 500)
  igual('el texto es el de los primeros 500', largas.notasPedido, 'x'.repeat(500))
  const cortas = reducerCarrito(base, { tipo: 'SET_NOTAS_PEDIDO', notas: 'sin sal' })
  igual('las notas cortas quedan tal cual', cortas.notasPedido, 'sin sal')
  // Persistencia: viaja en recortarParaPersistir y vuelve por deserializarCarrito.
  // OJO: el carrito tiene que tener items. `deserializarCarrito` devuelve null si esta vacio (a
  // proposito: un carrito sin items no se rehidrata), asi que un roundtrip sobre el estado
  // inicial daria undefined y el test estaria mintiendo.
  const conItem = { ...cortas, items: [{ clave: 'a', itemId: 'i', nombre: 'H', precioBase: 100, cantidad: 1, notas: '', modificadores: [] }], fase: 'checkout' as const }
  chk('se persisten con el resto del formulario', recortarParaPersistir(conItem).notasPedido === 'sin sal')
  const ida = deserializarCarrito(JSON.stringify(recortarParaPersistir(conItem)), 'bar-la-esquina')
  igual('y sobreviven el roundtrip de localStorage', ida?.notasPedido, 'sin sal')
  igual('junto con los items (el carrito no se pierde)', ida?.items.length, 1)
  // Si el guardado viene corrupto o de una version vieja, no explota.
  const sucio = deserializarCarrito(JSON.stringify({ items: [{ itemId: 'i', precioBase: 1, cantidad: 1, modificadores: [] }], notasPedido: 42 }), 'x')
  chk('un notasPedido invalido se descarta en vez de romper', (sucio?.notasPedido ?? '') === '')
  // No es obligatorio: el checkout valida solo, y esto no agrega ni saca fallas.
  const vacioConItems = { ...base, items: [{ clave: 'a', itemId: 'i', nombre: 'H', precioBase: 100, cantidad: 1, notas: '', modificadores: [] }], tipo: 'TAKEAWAY', modoPago: 'EFECTIVO', cliente: { nombre: 'Ana', telefono: '1155512345' } }
  igual('sin notas el checkout sigue valido', Object.keys(validarCheckout(vacioConItems)), [])
  chk('y con notas tambien (no es obligatorio)', Object.keys(validarCheckout({ ...vacioConItems, notasPedido: '' })).length === 0)
}
console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
if (fallas.length > 0) {
  console.log(fallas.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
