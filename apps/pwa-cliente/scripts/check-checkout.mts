/**
 * Check del checkout (QR #1, etapa 4).
 *
 * Corre en node pelado (sin Vitest, sin jsdom, sin browser):
 *
 *   node scripts/check-checkout.mts
 *
 * DOMINIO: lo que pasa entre que el cliente toca "Enviar pedido" y el pedido queda creado.
 * Todo lo de este archivo se mueve aca y NO se duplica en check:carrito (regla: cada check mide un
 * dominio; duplicar crea divergencia porque al cambiar el codigo se actualiza un solo lugar).
 *
 * Verifica: guardas del reducer (ENVIAR), transiciones (PEDIDO_OK / PEDIDO_ERROR / REINTENTAR),
 * validarCheckout por combinacion, clasificarError por status, normalizarError y armarBody.
 */
import {
  clasificarError,
  deserializarCarrito,
  estadoInicial,
  recortarParaPersistir,
  reducerCarrito,
  validarCheckout,
} from '../lib/carrito-maquina.ts'
import type { EstadoCarrito, ItemCarta, ModificadorElegido } from '../lib/carrito-maquina.ts'
import { ETIQUETAS_MODO_PAGO, armarBody, clasificarFalloPedido, normalizarError, urlWhatsAppStaff } from '../lib/checkout-maquina.ts'
import { validarTelefonoE164 } from '../lib/carrito-maquina.ts'
import { modificadoresParaApi } from '../lib/modificadores-seleccion.ts'

let ok = 0
const fallas: string[] = []

function chk(nombre: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`  OK    ${nombre}`) }
  else { fallas.push(`${nombre} ${detalle ? ' -> ' + detalle : ''}`); console.log(`  FALLA ${nombre} ${detalle}`) }
}
function igual<T>(nombre: string, real: T, esperado: T) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

const NEG = 'bar-la-esquina'
const SUC = 'cmuvjy4e0001qbq7jcfjrmflp'

const PIZZA: ItemCarta = { id: 'item-pizza', nombre: 'Pizza muzzarella', precio: 9500, disponible: true, grupos: [] }

function base(): EstadoCarrito {
  return estadoInicial(NEG, SUC, 'centro')
}
/** Carrito con un item listo para el checkout. */
function conCarrito(): EstadoCarrito {
  let e = reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
  e = reducerCarrito(e, { tipo: 'ABRIR_CHECKOUT' })
  return e
}
/** Carrito + todo el formulario completo y valido (DELIVERY). */
function listo(): EstadoCarrito {
  let e = reducerCarrito(conCarrito(), { tipo: 'SET_TIPO', nuevoTipo: 'DELIVERY' })
  e = reducerCarrito(e, { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' })
  e = reducerCarrito(e, { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'Ana' })
  e = reducerCarrito(e, { tipo: 'SET_CLIENTE', campo: 'telefono', valor: '+5491155512345' })
  e = reducerCarrito(e, { tipo: 'SET_CLIENTE', campo: 'direccion', valor: 'Av Siempreviva 742' })
  return e
}

// --- 1. validarCheckout por combinacion --------------------------------------
console.log('\n== validarCheckout ==')
igual('carrito vacio no pasa', !!validarCheckout(base()).items, true)
const sinTipo = conCarrito()
igual('sin tipo no pasa', !!validarCheckout(sinTipo).tipo, true)
igual('y tambien falta el modo de pago', !!validarCheckout(sinTipo).modoPago, true)
igual('y el nombre', !!validarCheckout(sinTipo).nombre, true)
let d = reducerCarrito(reducerCarrito(sinTipo, { tipo: 'SET_TIPO', nuevoTipo: 'DELIVERY' }), { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' })
d = reducerCarrito(d, { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'Ana' })
d = reducerCarrito(d, { tipo: 'SET_CLIENTE', campo: 'telefono', valor: '+5491155512345' })
igual('DELIVERY sin direccion no pasa', !!validarCheckout(d).direccion, true)
let m = reducerCarrito(conCarrito(), { tipo: 'SET_TIPO', nuevoTipo: 'MESA' })
m = reducerCarrito(m, { tipo: 'SET_MODO_PAGO', modoPago: 'EFECTIVO' })
m = reducerCarrito(m, { tipo: 'SET_CLIENTE', campo: 'nombre', valor: 'Ana' })
m = reducerCarrito(m, { tipo: 'SET_CLIENTE', campo: 'telefono', valor: '+5491155512345' })
igual('MESA sin numero de mesa no pasa', !!validarCheckout(m).mesa, true)
m = reducerCarrito(m, { tipo: 'SET_CLIENTE', campo: 'mesa', valor: '7' })
igual('MESA con numero pasa', Object.keys(validarCheckout(m)), [])
igual('nombre de una sola letra no pasa', !!validarCheckout({ ...m, cliente: { ...m.cliente, nombre: 'A' } }).nombre, true)
igual('telefono corto no pasa', !!validarCheckout({ ...m, cliente: { ...m.cliente, telefono: '123' } }).telefono, true)
igual('con todo completo no hay fallas', Object.keys(validarCheckout(listo())), [])
chk('las notas del pedido NO son obligatorias', Object.keys(validarCheckout({ ...listo(), notasPedido: '' })).length === 0)

// --- 2. Guardas del reducer (ENVIAR) ----------------------------------------
console.log('\n== guardas de ENVIAR ==')
igual('sin datos no se envia (queda en checkout)', reducerCarrito(conCarrito(), { tipo: 'ENVIAR' }).fase, 'checkout')
igual('con carrito vacio no se envia', reducerCarrito(base(), { tipo: 'ENVIAR' }).fase, 'vacio')
const enEnvio = reducerCarrito(listo(), { tipo: 'ENVIAR' })
igual('con datos validos pasa a enviando', enEnvio.fase, 'enviando')
igual('ENVIAR dos veces no hace nada (anti doble tap)', reducerCarrito(enEnvio, { tipo: 'ENVIAR' }), enEnvio)
igual('y con el pedido ya enviado tampoco', reducerCarrito(reducerCarrito(enEnvio, { tipo: 'PEDIDO_OK', linkToken: 't' }), { tipo: 'ENVIAR' }).fase, 'enviado')

// --- 3. PEDIDO_OK: los 4 campos --------------------------------------------
console.log('\n== PEDIDO_OK ==')
const creado = reducerCarrito(enEnvio, {
  tipo: 'PEDIDO_OK', linkToken: 'tok-123', numero: 7,
  urlCorta: 'https://wa.me/5491155512345', mensajeWhatsApp: 'Hola, mi pedido',
})
igual('queda en fase enviado', creado.fase, 'enviado')
igual('el carrito se vacia (no hace falta LIMPIAR despues)', creado.items.length, 0)
igual('conserva cliente, tipo y modoPago', [creado.cliente.nombre, creado.tipo, creado.modoPago], ['Ana', 'DELIVERY', 'EFECTIVO'])
igual('guarda los 4 campos del pedido',
  [creado.pedido?.linkToken, creado.pedido?.numero, creado.pedido?.urlCorta, creado.pedido?.mensajeWhatsApp],
  ['tok-123', 7, 'https://wa.me/5491155512345', 'Hola, mi pedido'])
const persistido = recortarParaPersistir(creado)
igual('los 4 se persisten',
  [persistido.pedido?.linkToken, persistido.pedido?.numero, persistido.pedido?.urlCorta, persistido.pedido?.mensajeWhatsApp],
  ['tok-123', 7, 'https://wa.me/5491155512345', 'Hola, mi pedido'])
// La vuelta necesita items: deserializarCarrito devuelve null si el carrito esta vacio.
const vuelta = deserializarCarrito(JSON.stringify({ ...persistido, items: [{ clave: 'a', itemId: 'i', nombre: 'H', precioBase: 100, cantidad: 1, notas: '', modificadores: [] }] }), NEG)
igual('y vuelven del localStorage', [vuelta?.pedido?.urlCorta, vuelta?.pedido?.mensajeWhatsApp], ['https://wa.me/5491155512345', 'Hola, mi pedido'])
igual('un pedido viejo (solo linkToken) no rompe', deserializarCarrito(JSON.stringify({ ...persistido, items: [{ clave: 'a', itemId: 'i', nombre: 'H', precioBase: 100, cantidad: 1, notas: '', modificadores: [] }], pedido: { linkToken: 'viejo' } }), NEG)?.pedido?.urlCorta, undefined)

// --- 4. PEDIDO_ERROR y REINTENTAR -------------------------------------------
console.log('\n== PEDIDO_ERROR / REINTENTAR ==')
const conError = reducerCarrito(enEnvio, { tipo: 'PEDIDO_ERROR', status: 429, mensaje: 'Demasiados pedidos' })
igual('vuelve a checkout para poder reintentar', conError.fase, 'checkout')
igual('y el error queda clasificado en el estado', conError.error?.codigo, 'RATE_LIMIT')
igual('REINTENTAR limpia el error', reducerCarrito(conError, { tipo: 'REINTENTAR' }).error, null)
igual('y no cambia la fase', reducerCarrito(conError, { tipo: 'REINTENTAR' }).fase, 'checkout')

// --- 5. clasificarError por status ------------------------------------------
console.log('\n== clasificarError ==')
igual('400 -> validacion con el texto del backend', clasificarError(400, 'El item no existe').mensaje, 'El item no existe')
igual('400 sin mensaje -> copy generico', clasificarError(400, '').codigo, 'VALIDACION')
igual('403 -> sucursal cerrada', clasificarError(403, '').codigo, 'SUCURSAL_CERRADA')
igual('410 -> carta vencida (NO es red)', clasificarError(410, '').codigo, 'CARTA_VENCIDA')
chk('410 manda a recargar, no a reintentar', clasificarError(410, '').mensaje.toLowerCase().includes('recarg'), clasificarError(410, '').mensaje)
igual('422 -> validacion', clasificarError(422, 'mal').codigo, 'VALIDACION')
igual('429 -> rate limit', clasificarError(429, '').codigo, 'RATE_LIMIT')
chk('429 explica que fue por muchos pedidos', clasificarError(429, '').mensaje.includes('Esperá'), clasificarError(429, '').mensaje)
igual('500 -> red/servidor', clasificarError(500, '').codigo, 'RED')
igual('status 0 (sin red) -> red', clasificarError(0, '').codigo, 'RED')
igual('un status raro cae en el generico', clasificarError(418, 'teapot').codigo, 'DESCONOCIDO')

// --- 6. normalizarError ------------------------------------------------------
console.log('\n== normalizarError ==')
const apiErr = (status: number, data?: unknown) => Object.assign(new Error('boom'), { status, data })
igual('status real + message string', normalizarError(apiErr(400, { message: 'Datos invalidos' })), { status: 400, mensaje: 'Datos invalidos' })
igual('message ARRAY (class-validator) se une con espacios',
  normalizarError(apiErr(400, { message: ['property x should not exist', 'property y is required'] })),
  { status: 400, mensaje: 'property x should not exist property y is required' })
igual('array con cosas que no son string se filtra',
  normalizarError(apiErr(400, { message: ['uno', 42, null] })).mensaje, 'uno')
igual('status sin data cae al message del Error', normalizarError(apiErr(500)).mensaje, 'boom')
igual('StatusError de 401 sin data ni message util', normalizarError(apiErr(401, { message: '' })).status, 401)
// El caso que el plan asumia y que el cliente NO produce: fetch que ni sale.
igual('fetch que falla (TypeError) -> status 0 sintetico', normalizarError(new TypeError('Failed to fetch')), { status: 0, mensaje: 'Failed to fetch' })
igual('un throw cualquiera tambien es status 0', normalizarError('cualquier cosa').status, 0)
igual('y null no rompe', normalizarError(null).status, 0)

// --- 7. armarBody ------------------------------------------------------------
console.log('\n== armarBody ==')
const conMods: ModificadorElegido[] = [
  { grupoId: 'g1', grupoNombre: 'Aderezos', opciones: [{ id: 'o1', nombre: 'Mayonesa', precioExtra: 0 }, { id: 'o2', nombre: 'BBQ', precioExtra: 200 }] },
]
let conItem = reducerCarrito(reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 2, modificadores: conMods, notas: 'sin sal' }), { tipo: 'ABRIR_CHECKOUT' })
conItem = reducerCarrito(conItem, { tipo: 'SET_TIPO', nuevoTipo: 'MESA' })
conItem = reducerCarrito(conItem, { tipo: 'SET_CLIENTE', campo: 'mesa', valor: '7' })
conItem = reducerCarrito(conItem, { tipo: 'SET_MODO_PAGO', modoPago: 'TRANSFERENCIA' })
conItem = reducerCarrito(conItem, { tipo: 'SET_CLIENTE', campo: 'nombre', valor: '  Ana  ' })
conItem = reducerCarrito(conItem, { tipo: 'SET_CLIENTE', campo: 'telefono', valor: ' +5491155512345 ' })
conItem = reducerCarrito(conItem, { tipo: 'SET_NOTAS_PEDIDO', notas: 'tocar timbre' })
const body = armarBody(conItem)
igual('usa nombreCliente (NO nombre)', [Object.hasOwn(body, 'nombreCliente'), Object.hasOwn(body, 'nombre')], [true, false])
igual('y el nombre va sin espacios de sobra', body.nombreCliente, 'Ana')
igual('usa mesa (NO numeroMesa)', [Object.hasOwn(body, 'mesa'), Object.hasOwn(body, 'numeroMesa')], [true, false])
igual('el telefono va sin espacios', body.telefono, '+5491155512345')
igual('tipo y modo de pago tal cual', [body.tipo, body.modoPago], ['MESA', 'TRANSFERENCIA'])
igual('la mesa solo va si el tipo es MESA', body.mesa, '7')
igual('sin direccion cuando es MESA', Object.hasOwn(body, 'direccion'), false)
igual('la direccion va cuando es DELIVERY', Object.hasOwn(armarBody({ ...conItem, tipo: 'DELIVERY', cliente: { ...conItem.cliente, direccion: 'Av Siempreviva 742' } }), 'direccion'), true)
igual('las notas del pedido viajan a nivel pedido', body.notas, 'tocar timbre')
igual('sin notas no se manda el campo', Object.hasOwn(armarBody({ ...conItem, notasPedido: '' }), 'notas'), false)
igual('la sucursal viaja para resolver el override', [body.sucursalId, body.sucursalSlug], [SUC, 'centro'])
// items
igual('un item por linea', body.items.length, 1)
igual('cantidad y notas por item', [body.items[0].cantidad, body.items[0].notas], [2, 'sin sal'])
igual('los modificadores van como {grupoId, opcionIds}',
  body.items[0].modificadores, [{ grupoId: 'g1', opcionIds: ['o1', 'o2'] }])
igual('y son los mismos que arma modificadoresParaApi', body.items[0].modificadores, modificadoresParaApi(conMods))
chk('el body NO manda precio (lo recalcula el backend)', !Object.hasOwn(body.items[0], 'precio'), JSON.stringify(body.items[0]))
const sinMods = armarBody(reducerCarrito(base(), { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' }))
igual('sin modificadores no se manda el campo', Object.hasOwn(sinMods.items[0], 'modificadores'), false)
igual('sin notas de item tampoco', Object.hasOwn(sinMods.items[0], 'notas'), false)
igual('sin sucursal resuelta no se mandan los campos de sucursal',
  ['sucursalId', 'sucursalSlug'].filter((k) => Object.hasOwn(armarBody(estadoInicial(NEG, null, null)), k)), [])
igual('un carrito vacio arma un body con items vacio (la validacion lo frena antes)',
  armarBody(estadoInicial(NEG, SUC, 'centro')).items.length, 0)


// --- 8. Cambiar de tipo limpia lo que ya no aplica ---------------------------
console.log('\n== cambio de tipo ==')
let t = reducerCarrito(conCarrito(), { tipo: 'SET_TIPO', nuevoTipo: 'MESA' })
t = reducerCarrito(t, { tipo: 'SET_CLIENTE', campo: 'mesa', valor: '7' })
igual('la mesa queda cargada', t.cliente.mesa, '7')
igual('al pasar a TAKEAWAY se limpia la mesa que ya no aplica',
  reducerCarrito(t, { tipo: 'SET_TIPO', nuevoTipo: 'TAKEAWAY' }).cliente.mesa, undefined)
let td = reducerCarrito(conCarrito(), { tipo: 'SET_TIPO', nuevoTipo: 'DELIVERY' })
td = reducerCarrito(td, { tipo: 'SET_CLIENTE', campo: 'direccion', valor: 'Av Siempreviva 742' })
igual('pasar de DELIVERY a TAKEAWAY borra la direccion',
  reducerCarrito(td, { tipo: 'SET_TIPO', nuevoTipo: 'TAKEAWAY' }).cliente.direccion, undefined)

// --- 9. Notas generales del pedido (SET_NOTAS_PEDIDO) ------------------------
console.log('\n== notas del pedido ==')
{
  const vacio = base()
  const largas = reducerCarrito(vacio, { tipo: 'SET_NOTAS_PEDIDO', notas: 'x'.repeat(700) })
  igual('se truncan a 500 (el maximo del backend)', largas.notasPedido?.length, 500)
  igual('el texto es el de los primeros 500', largas.notasPedido, 'x'.repeat(500))
  const cortas = reducerCarrito(vacio, { tipo: 'SET_NOTAS_PEDIDO', notas: 'sin sal' })
  igual('las notas cortas quedan tal cual', cortas.notasPedido, 'sin sal')
  // Persistencia: viaja en recortarParaPersistir y vuelve por deserializarCarrito. OJO: el carrito
  // tiene que tener items, porque deserializarCarrito devuelve null si esta vacio (y el test
  // estaria probando un camino que no existe).
  const conItem = { ...cortas, items: [{ clave: 'a', itemId: 'i', nombre: 'H', precioBase: 100, cantidad: 1, notas: '', modificadores: [] }], fase: 'checkout' as const }
  chk('se persisten con el resto del formulario', recortarParaPersistir(conItem).notasPedido === 'sin sal')
  const ida = deserializarCarrito(JSON.stringify(recortarParaPersistir(conItem)), NEG)
  igual('y sobreviven el roundtrip de localStorage', ida?.notasPedido, 'sin sal')
  igual('junto con los items (el carrito no se pierde)', ida?.items.length, 1)
  chk('un notasPedido invalido se descarta en vez de romper',
    (deserializarCarrito(JSON.stringify({ items: [{ itemId: 'i', precioBase: 1, cantidad: 1, modificadores: [] }], notasPedido: 42 }), 'x')?.notasPedido ?? '') === '')
}


// --- 10. Etiquetas de la forma de pago ---------------------------------------
console.log('\n== etiquetas de pago ==')
igual('cada forma de pago tiene su etiqueta',
  Object.values(ETIQUETAS_MODO_PAGO), ['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta'])
chk('ninguna queda en minuscula ni con guion bajo',
  Object.values(ETIQUETAS_MODO_PAGO).every((v) => v !== v.toLowerCase() && !v.includes('_')),
  JSON.stringify(Object.values(ETIQUETAS_MODO_PAGO)))
igual('estan las 4 del enum', Object.keys(ETIQUETAS_MODO_PAGO).sort(), ['EFECTIVO', 'MERCADO_PAGO', 'TARJETA', 'TRANSFERENCIA'])


// --- 11. Telefono E.164 ------------------------------------------------------
console.log('\n== telefono E.164 ==')
chk('acepta el ejemplo del backend', validarTelefonoE164('+5491112345678') === true)
chk('rechaza un numero sin codigo de pais', validarTelefonoE164('3423432') === false)
chk('acepta el minimo de 10 digitos', validarTelefonoE164('+549111234567') === true)
chk('rechaza mas de 15 digitos', validarTelefonoE164('+1234567890123456') === false)
chk('rechaza vacio', validarTelefonoE164('') === false)
chk('rechaza sin el +', validarTelefonoE164('5491112345678') === false)
chk('rechaza letras', validarTelefonoE164('+54911abc45678') === false)


// --- 12. Pedido viejo en el store + OLVIDAR_PEDIDO ---------------------------
console.log('\n== pedido viejo ==')
let conPedido = conCarrito()
conPedido = reducerCarrito(conPedido, { tipo: 'PEDIDO_OK', linkToken: 'tok-viejo' })
igual('PEDIDO_OK vacia los items', conPedido.items.length, 0)
igual('PEDIDO_OK deja la fase en enviado', conPedido.fase, 'enviado')
// Agregar un item ARRANCA un pedido nuevo: la fase NO puede quedarse en 'enviado', porque el guard
// de ENVIAR la lee y bloquearia el envio para siempre. Por eso `items + enviado` es inalcanzable.
const conPedidoYNuevo = reducerCarrito(conPedido, { tipo: 'AGREGAR_ITEM', item: PIZZA, cantidad: 1, modificadores: [], notas: '' })
chk('agregar despues de pedir saca la fase de enviado', conPedidoYNuevo.fase !== 'enviado', `fase=${conPedidoYNuevo.fase}`)
igual('y la deja en conItems', conPedidoYNuevo.fase, 'conItems')
chk('el pedido guardado sobrevive (banner)', conPedidoYNuevo.pedido?.linkToken === 'tok-viejo')
// OLVIDAR_PEDIDO: suelta SOLO el pedido (404 del seguimiento).
const olvidado = reducerCarrito(conPedidoYNuevo, { tipo: 'OLVIDAR_PEDIDO' })
igual('OLVIDAR_PEDIDO limpia el pedido', olvidado.pedido, null)
igual('OLVIDAR_PEDIDO conserva los items', olvidado.items.length, 1)
igual('OLVIDAR_PEDIDO conserva la fase', olvidado.fase, 'conItems')
igual('OLVIDAR_PEDIDO es idempotente', reducerCarrito(olvidado, { tipo: 'OLVIDAR_PEDIDO' }).pedido, null)


// --- 13. Fallos del seguimiento: el mismo 404, dos significados -------------
console.log('\n== fallos del seguimiento ==')
// 404 del TenantGuard: el header llego tarde (los efectos corren de hijo a padre). Reintentable.
igual('404 falta el tenant es reintentable',
  clasificarFalloPedido(404, 'Falta el tenant (X-Tenant-Slug) para esta operacion'), 'tenant')
// 404 real: ese link no existe. Terminal.
igual('404 pedido no encontrado es terminal', clasificarFalloPedido(404, 'Pedido no encontrado'), 'no-encontrado')
igual('el mensaje del tenant no depende de mayusculas', clasificarFalloPedido(404, 'FALTA EL TENANT'), 'tenant')
igual('410 es link vencido', clasificarFalloPedido(410, 'cualquiera'), 'vencido')
igual('500 es otro (no terminal)', clasificarFalloPedido(500, ''), 'otro')
igual('un 404 con mensaje desconocido cae al lado terminal', clasificarFalloPedido(404, ''), 'no-encontrado')


// --- 14. Link de WhatsApp del staff -----------------------------------------
console.log('\n== link de WhatsApp ==')
const MSG_WA = 'Nuevo pedido de oscar\n\n-----\nTotal: $1.500\n\nVerificá el pedido acá: http://192.168.0.103:3002/pedido/tok-1'
igual('la base es wa.me con los digitos pelados',
  urlWhatsAppStaff('+5493585705745', 'hola'), 'https://wa.me/5493585705745?text=hola')
igual('saca espacios, guiones y parentesis',
  urlWhatsAppStaff('+54 (9) 358-570-5745', 'hola'), 'https://wa.me/5493585705745?text=hola')
igual('sin digitos no hay link', urlWhatsAppStaff('', 'hola'), null)
igual('null tampoco', urlWhatsAppStaff(null, 'hola'), null)
chk('la base NO es la url del staff (el bug original)',
  urlWhatsAppStaff('+5493585705745', MSG_WA)?.startsWith('https://wa.me/5493585705745?text=') === true)
chk('el mensaje viaja codificado y conserva el link del staff adentro',
  urlWhatsAppStaff('+5493585705745', MSG_WA)?.includes(encodeURIComponent('http://192.168.0.103:3002/pedido/tok-1')) === true)

console.log(fallas.length === 0
  ? `\nTODO OK: ${ok} aserciones OK, 0 fallas\n`
  : `\nHAY FALLAS: ${ok} aserciones OK, ${fallas.length} fallas\n${fallas.map((f) => ' - ' + f).join('\n')}\n`)
if (fallas.length > 0) process.exit(1)
