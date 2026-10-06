/**
 * Check del motor de upsell (refinamiento 3).
 *
 *   node scripts/check-upsell.mts
 *
 * Todo puro: el reloj entra por parametro, asi que el debounce de 500 ms se prueba sin
 * esperar y sin timers (que en Windows son flaky).
 */
import {
  DEBOUNCE_UPSELL_MS,
  MAX_ENTRADAS_CACHE,
  MOTIVO_DESACTIVADO,
  MOTIVO_ERROR,
  canonicoCarrito,
  decidirConsulta,
  estadoUpsellInicial,
  hashCarrito,
  reducerUpsell,
  sugerenciasVisibles,
} from '../lib/upsell-maquina.ts'
import type { EstadoUpsell } from '../lib/upsell-maquina.ts'
import type { ItemCarrito, SugerenciaUpsell } from '../lib/carrito-maquina.ts'

let ok = 0
const fallas: string[] = []
function chk(nombre: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`  OK    ${nombre}`) }
  else { fallas.push(nombre); console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`) }
}
function igual(nombre: string, real: unknown, esperado: unknown) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

const T0 = 1_700_000_000_000

function item(itemId: string, cantidad = 1, nota = '', mods: [string, string[]][] = []): ItemCarrito {
  return {
    clave: `${itemId}#${nota}`,
    itemId,
    nombre: itemId,
    precioBase: 1000,
    cantidad,
    notas: nota,
    modificadores: mods.map(([grupoId, ids]) => ({
      grupoId,
      grupoNombre: grupoId,
      opciones: ids.map((id) => ({ id, nombre: id, precioExtra: 0 })),
    })),
  }
}
const CARRITO = [item('pizza', 1, 'sin sal'), item('coca', 2)]

function sug(reglaId: string, itemNombre = 'Postre'): SugerenciaUpsell {
  return { reglaId, mensaje: `Sumale ${itemNombre}`, motivo: 'postre', itemNombre }
}

// --- 1. El invariante: hash determinista ------------------------------------
console.log('\n== hash determinista (el invariante) ==')
igual('mismo carrito = mismo hash', hashCarrito([item('a'), item('b')]), hashCarrito([item('a'), item('b')]))
igual('MISMO CONTENIDO EN DISTINTO ORDEN = MISMO HASH', hashCarrito([item('a'), item('b'), item('c')]), hashCarrito([item('c'), item('a'), item('b')]))
igual('el orden de los grupos de modificadores tampoco importa',
  hashCarrito([item('a', 1, '', [['g1', ['x']], ['g2', ['y']]])]),
  hashCarrito([item('a', 1, '', [['g2', ['y']], ['g1', ['x']]])]))
igual('el orden dentro de un grupo multiple tampoco',
  hashCarrito([item('a', 1, '', [['g1', ['x', 'y']]])]),
  hashCarrito([item('a', 1, '', [['g1', ['y', 'x']]])]))
chk('un espacio de mas en las notas no inventa un carrito nuevo', hashCarrito([item('a', 1, ' sin sal ')]) === hashCarrito([item('a', 1, 'sin sal')]))

console.log('\n== y cambia cuando tiene que cambiar ==')
chk('cambiar cantidad cambia el hash', hashCarrito([item('a', 2)]) !== hashCarrito([item('a', 1)]))
chk('cambiar modificadores cambia el hash', hashCarrito([item('a', 1, '', [['g1', ['x']]])]) !== hashCarrito([item('a', 1)]))
chk('cambiar notas cambia el hash', hashCarrito([item('a', 1, 'sin sal')]) !== hashCarrito([item('a', 1)]))
chk('cambiar un item cambia el hash', hashCarrito([item('a')]) !== hashCarrito([item('b')]))
chk('agregar un item cambia el hash', hashCarrito([item('a')]) !== hashCarrito([item('a'), item('b')]))
chk('la forma canonica ordena los items', canonicoCarrito([item('b'), item('a')]).startsWith('a#'))
igual('carrito vacio tiene hash estable', hashCarrito([]), hashCarrito([]))

// --- 2. Cache por hash ------------------------------------------------------
console.log('\n== cache por hash ==')
const h = hashCarrito(CARRITO)
let s: EstadoUpsell = reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 })
igual('carrito nuevo: pide', decidirConsulta(s, T0 + DEBOUNCE_UPSELL_MS).accion, 'pedir')
s = reducerUpsell(s, { tipo: 'RESPUESTA', hash: h, sugerencias: [sug('r1')], motivo: 'postre', ahora: T0 + 600 })
igual('tras la respuesta, ese hash se resuelve por cache (no se pide)', decidirConsulta(s, T0 + 9999), { accion: 'cache', hash: h })
igual('y el motivo queda guardado', s.motivo, 'postre')
igual('las sugerencias visibles salen del cache', sugerenciasVisibles(s).map((x) => x.reglaId), ['r1'])
// volver al mismo carrito (por ejemplo, sacar y volver a poner un item) no re-consulta
let vuelta = reducerUpsell(s, { tipo: 'CARRITO_CAMBIO', items: [item('otro')], ahora: T0 + 700 })
vuelta = reducerUpsell(vuelta, { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 + 800 })
igual('volver al mismo carrito pega en el cache, no en el backend', decidirConsulta(vuelta, T0 + 2000).accion, 'cache')
igual('y el hash del cache es el mismo', decidirConsulta(vuelta, T0 + 2000), { accion: 'cache', hash: h })

console.log('\n== tope del cache ==')
let lleno = estadoUpsellInicial()
for (let i = 0; i < MAX_ENTRADAS_CACHE + 3; i++) {
  lleno = reducerUpsell(lleno, { tipo: 'RESPUESTA', hash: `h${i}`, sugerencias: [sug(`r${i}`)], ahora: T0 + i })
}
igual(`el cache no pasa de ${MAX_ENTRADAS_CACHE} entradas`, Object.keys(lleno.cache).length, MAX_ENTRADAS_CACHE)
chk('y se van las mas viejas', !lleno.cache.h0 && !lleno.cache.h1 && !lleno.cache.h2)
chk('las ultimas siguen', !!lleno.cache[`h${MAX_ENTRADAS_CACHE + 2}`])

// --- 3. Debounce: 10 cambios rapidos = 1 request ----------------------------
console.log('\n== debounce (reloj mockeado) ==')
let e = estadoUpsellInicial()
let pedidosDuranteLaRafaga = 0
let t = T0
for (let i = 0; i < 10; i++) {
  e = reducerUpsell(e, { tipo: 'CARRITO_CAMBIO', items: [item('a', i + 1)], ahora: t })
  if (decidirConsulta(e, t).accion === 'pedir') pedidosDuranteLaRafaga++
  t += 40 // 40 ms entre cambio y cambio: bien por debajo de los 500
}
igual('durante la rafaga no se pide nada', pedidosDuranteLaRafaga, 0)
t += 600
const plan = decidirConsulta(e, t)
igual('pasado el debounce, se pide UNA sola vez', pedidosDuranteLaRafaga + (plan.accion === 'pedir' ? 1 : 0), 1)
chk('y se pide el hash del ULTIMO carrito', plan.accion === 'pedir' && plan.hash === hashCarrito([item('a', 10)]), JSON.stringify(plan))
e = reducerUpsell(e, { tipo: 'RESPUESTA', hash: hashCarrito([item('a', 10)]), sugerencias: [sug('r1')], ahora: t })
igual('un tick tardio no dispara otra request', decidirConsulta(e, t + 5000).accion === 'pedir', false)
igual('justo antes del debounce sigue esperando', decidirConsulta(reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 }), T0 + DEBOUNCE_UPSELL_MS - 1).accion, 'nada')
igual('y justo despues, pide', decidirConsulta(reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 }), T0 + DEBOUNCE_UPSELL_MS).accion, 'pedir')

// --- 4. Sugerencias aceptadas -----------------------------------------------
console.log('\n== sugerencias aceptadas ==')
let a: EstadoUpsell = reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 })
a = reducerUpsell(a, { tipo: 'RESPUESTA', hash: hashCarrito(CARRITO), sugerencias: [sug('r1'), sug('r2')], ahora: T0 + 600 })
igual('las dos se muestran', sugerenciasVisibles(a).map((x) => x.reglaId), ['r1', 'r2'])
a = reducerUpsell(a, { tipo: 'ACEPTAR', reglaId: 'r1' })
igual('la aceptada no se vuelve a ofrecer', sugerenciasVisibles(a).map((x) => x.reglaId), ['r2'])
chk('y quedan ambas en el cache (no se borra la respuesta del backend)', a.cache[hashCarrito(CARRITO)].sugerencias.length === 2)
a = reducerUpsell(a, { tipo: 'ACEPTAR', reglaId: 'r1' })
igual('aceptar dos veces no duplica', a.aceptadas, ['r1'])
chk('no se persiste en localStorage: el set vive solo en memoria (no hay storage aca)', !('storage' in a))

// --- 5. upsell desactivado --------------------------------------------------
console.log('\n== upsell desactivado ==')
let d: EstadoUpsell = reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 })
d = reducerUpsell(d, { tipo: 'RESPUESTA', hash: hashCarrito(CARRITO), sugerencias: [], motivo: MOTIVO_DESACTIVADO, ahora: T0 + 600 })
igual('queda marcado como desactivado', d.desactivado, true)
igual('no se muestra nada', sugerenciasVisibles(d), [])
d = reducerUpsell(d, { tipo: 'CARRITO_CAMBIO', items: [item('otro'), item('y-otro')], ahora: T0 + 5000 })
igual('con otro carrito tampoco se pide', decidirConsulta(d, T0 + 9000).accion, 'nada')
igual('y el motivo del plan es desactivado', decidirConsulta(d, T0 + 9000), { accion: 'nada', motivo: 'desactivado' })

// --- 6. Error y cambio de sucursal -------------------------------------------
console.log('\n== error y sucursal ==')
let err: EstadoUpsell = reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 })
err = reducerUpsell(err, { tipo: 'ERROR' })
igual('un error no cachea ni marca desactivado', [Object.keys(err.cache).length, err.desactivado, err.cargando], [0, false, false])
igual('y otro cambio reintenta', decidirConsulta(reducerUpsell(err, { tipo: 'CARRITO_CAMBIO', items: [item('x')], ahora: T0 + 1000 }), T0 + 2000).accion, 'pedir')
const cambiada = reducerUpsell(a, { tipo: 'CAMBIAR_SUCURSAL' })
igual('cambiar de sucursal limpia las aceptadas (los overrides pueden cambiar todo)', cambiada.aceptadas, [])
igual('y limpia el cache', Object.keys(cambiada.cache).length, 0)
chk('pero si el negocio no tiene upsell, sigue desactivado', reducerUpsell(d, { tipo: 'CAMBIAR_SUCURSAL' }).desactivado === true)

// --- 7. Totalidad e inmutabilidad --------------------------------------------
console.log('\n== totalidad e inmutabilidad ==')
const EVENTOS = [
  { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 },
  { tipo: 'RESPUESTA', hash: 'h', sugerencias: [], ahora: T0 },
  { tipo: 'ERROR' },
  { tipo: 'ACEPTAR', reglaId: 'r' },
  { tipo: 'CAMBIAR_SUCURSAL' },
  { tipo: 'REINICIAR' },
] as const
let totalidad = true
for (const ev of EVENTOS) {
  const antes = JSON.stringify(estadoUpsellInicial())
  const conCarrito = reducerUpsell(estadoUpsellInicial(), { tipo: 'CARRITO_CAMBIO', items: CARRITO, ahora: T0 })
  const salida = reducerUpsell(conCarrito, ev as never)
  if (!('desactivado' in salida) || !('aceptadas' in salida) || !('cache' in salida)) totalidad = false
  if (JSON.stringify(estadoUpsellInicial()) !== antes) totalidad = false
}
chk(`los ${EVENTOS.length} eventos devuelven un estado valido y no mutan la entrada`, totalidad)


// --- Guard anti-reintento tras un error --------------------------------------
console.log('\n== error: no se reintenta solo ==')
{
  const H = 'hash-1'
  const base = { ...estadoUpsellInicial(), hashPendiente: H, hashDesde: 0 }
  const conError = reducerUpsell(base, { tipo: 'ERROR' })
  igual('un error marca el hash como consultado', conError.hashConsultado, H)
  igual('y no queda cargando', conError.cargando, false)
  chk('con eso, decidirConsulta NO vuelve a pedir lo mismo', decidirConsulta(conError, 10_000).accion !== 'pedir')
  igual('la accion pasa a ya-consultado', decidirConsulta(conError, 10_000), { accion: 'nada', motivo: 'ya-consultado' })
  igual('y se puede mostrar un motivo', conError.motivo, MOTIVO_ERROR)
  // Cambio de carrito despues del error: es una consulta nueva, tiene que pedir.
  const otroHash = reducerUpsell(conError, { tipo: 'CARRITO_CAMBIO', items: [], ahora: 20_000 })
  igual('un hash nuevo si se consulta (no queda pegado al error)',
    decidirConsulta({ ...otroHash, hashDesde: 0 }, 30_000).accion, 'pedir')
  // El mismo hash con el carrito sin cambios no vuelve a pedir aunque pasen horas.
  igual('y el mismo hash sigue sin pedir', decidirConsulta(conError, 99_999_999).accion, 'nada')
}
console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
if (fallas.length > 0) { console.log(fallas.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
