/**
 * Check del cache de la carta (refinamiento 4).
 *
 *   node scripts/check-carta.mts
 *
 * El reloj entra por parametro (`ahora`), asi que no hacen falta fake timers: los 5 minutos
 * se prueban con dos numeros distintos.
 */
import {
  AVISO_CARTA_VIEJA,
  TTL_CARTA_MS,
  cartaDeCache,
  claveDeCarta,
  decidirLectura,
  estadoCartaInicial,
  planDeFetch,
  reducerCarta,
} from '../lib/carta-cache.ts'
import type { EstadoCarta } from '../lib/carta-cache.ts'

let ok = 0
const fallas: string[] = []
function chk(nombre: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`  OK    ${nombre}`) }
  else { fallas.push(nombre); console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`) }
}
function igual(nombre: string, real: unknown, esperado: unknown) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

const NEG = 'bar-la-esquina'
const T0 = 1_700_000_000_000
const CARTA = { categorias: [{ id: 'c1', nombre: 'Bebidas', items: [{ id: 'i1' }] }], total: 1 }
type Carta = typeof CARTA

function conCache(llenoEn = T0): EstadoCarta<Carta> {
  const clave = claveDeCarta(NEG, 'centro')
  return reducerCarta<Carta>(estadoCartaInicial<Carta>(), { tipo: 'FETCH_OK', clave, datos: CARTA, ahora: llenoEn })
}
function seleccionar(estado: EstadoCarta<Carta>, sucursalSlug: string | null, ahora: number) {
  return reducerCarta<Carta>(estado, { tipo: 'SELECCIONAR', negocioSlug: NEG, sucursalSlug, ahora })
}

// --- 1. Clave ---------------------------------------------------------------
console.log('\n== clave de cache ==')
igual('la clave incluye negocio y sucursal', claveDeCarta(NEG, 'centro'), 'carta_bar-la-esquina_centro')
igual('sin sucursal tiene clave propia', claveDeCarta(NEG, null), 'carta_bar-la-esquina_sin-sucursal')
chk('cambiar de categoria NO puede cambiar la clave (no es parte de ella)',
    claveDeCarta(NEG, 'centro') === claveDeCarta(NEG, 'centro'))
chk('cambiar de sucursal SI cambia la clave', claveDeCarta(NEG, 'centro') !== claveDeCarta(NEG, 'norte'))

// --- 2. TTL de 5 min --------------------------------------------------------
console.log('\n== TTL de 5 min (reloj mockeado) ==')
igual('TTL configurado en 5 min', TTL_CARTA_MS, 5 * 60 * 1000)
const entrada = { datos: CARTA, guardadoEn: T0 }
igual('a los 4:59 esta fresca', decidirLectura(entrada, T0 + 4 * 60_000 + 59_000), 'fresca')
igual('a los 5:00 exactos vence', decidirLectura(entrada, T0 + 5 * 60_000), 'vencida')
igual('a los 10 min sigue vencida', decidirLectura(entrada, T0 + 10 * 60_000), 'vencida')
igual('sin entrada es ausente', decidirLectura(undefined, T0), 'ausente')

// --- 3. Cache-first: con TTL valido no se llama al fetch --------------------
console.log('\n== cache-first ==')
let s = conCache()
s = seleccionar(s, 'centro', T0 + 60_000)
igual('con cache fresca no queda refetch pendiente', s.refetchPendiente, false)
igual('y no se muestra el skeleton', s.cargando, false)
let plan = planDeFetch(s, T0 + 60_000)
igual('plan: sin fetch', [plan.bloqueante, plan.background], [false, false])
igual('plan: lectura fresca', plan.lectura, 'fresca')
igual('los datos se leen del cache', cartaDeCache(s, s.claveActiva)?.datos, CARTA)

// --- 4. Cambiar categoria no refetch ---------------------------------------
console.log('\n== cambiar categoria no refetch ==')
// La categoria es estado de UI: no entra a la clave, no toca el cache, no pide nada.
s = seleccionar(s, 'centro', T0 + 90_000)
plan = planDeFetch(s, T0 + 90_000)
igual('sigue sin refetch aunque pasen los cambios de categoria', [plan.bloqueante, plan.background], [false, false])
igual('el cache sigue siendo el mismo', s.porClave[claveDeCarta(NEG, 'centro')].datos, CARTA)
igual('y no hay aviso', s.aviso, null)

// --- 5. Vencida: muestra lo viejo y actualiza en background -----------------
console.log('\n== stale-while-revalidate ==')
const ahoraVencida = T0 + 6 * 60_000
s = seleccionar(s, 'centro', ahoraVencida)
plan = planDeFetch(s, ahoraVencida)
igual('vencida: fetch en background, sin bloquear', [plan.bloqueante, plan.background], [false, true])
igual('vencida: la pantalla NO se queda vacia', s.cargando, false)
chk('vencida: los datos viejos se siguen mostrando', cartaDeCache(s, s.claveActiva)?.datos === CARTA)

// --- 6. Sin cache: fetch bloqueante ---------------------------------------
console.log('\n== sin cache ==')
let vacio = seleccionar(estadoCartaInicial<Carta>(), 'centro', T0)
plan = planDeFetch(vacio, T0)
igual('sin cache: fetch bloqueante', [plan.bloqueante, plan.background], [true, false])
igual('sin cache: se muestra el skeleton', vacio.cargando, true)

// --- 7. Cambiar de sucursal: si refetch -----------------------------------
console.log('\n== cambiar de sucursal ==')
let conNorte = seleccionar(conCache(), 'norte', T0 + 60_000)
igual('la clave activa pasa a la sucursal nueva', conNorte.claveActiva, claveDeCarta(NEG, 'norte'))
plan = planDeFetch(conNorte, T0 + 60_000)
igual('sucursal nueva: fetch bloqueante (no hay cache de esa sucursal)', [plan.bloqueante, plan.background], [true, false])
chk('el cache de la sucursal vieja queda intacto (volver no refetchea)',
    planDeFetch(seleccionar(conNorte, 'centro', T0 + 61_000), T0 + 61_000).background === false)
const invalidado = reducerCarta(conNorte, { tipo: 'INVALIDAR', clave: claveDeCarta(NEG, 'centro') })
igual('invalidar borra esa clave (norte no tenia datos)', Object.keys(invalidado.porClave), [])
igual('invalidar la que no tiene datos no rompe', Object.keys(reducerCarta(conNorte, { tipo: 'INVALIDAR', clave: 'carta_otro_centro' }).porClave), [claveDeCarta(NEG, 'centro')])

// --- 8. Fetch fallido ----------------------------------------------------
console.log('\n== fetch fallido ==')
const antes = conCache()
const conAviso = reducerCarta<Carta>(seleccionar(antes, 'centro', T0 + 6 * 60_000), { tipo: 'FETCH_ERROR', clave: claveDeCarta(NEG, 'centro') })
igual('NO sobreescribe el cache viejo', cartaDeCache(conAviso, claveDeCarta(NEG, 'centro'))?.datos, CARTA)
igual('mantiene el timestamp original (el TTL no se renueva con un error)', cartaDeCache(conAviso, claveDeCarta(NEG, 'centro'))?.guardadoEn, T0)
igual('deja el aviso de que se ve lo guardado', conAviso.aviso, AVISO_CARTA_VIEJA)
igual('no queda cargando ni pendiente', [conAviso.cargando, conAviso.refetchPendiente], [false, false])
chk('el aviso se puede descartar', reducerCarta(conAviso, { tipo: 'DESCARTAR_AVISO' }).aviso === null)
const sinNada = reducerCarta<Carta>(seleccionar(estadoCartaInicial<Carta>(), 'centro', T0), { tipo: 'FETCH_ERROR', clave: claveDeCarta(NEG, 'centro') })
igual('si no habia nada, no aparece magia: sigue sin datos', cartaDeCache(sinNada, claveDeCarta(NEG, 'centro')), undefined)

// --- 9. Exito despues de un error -------------------------------------------
console.log('\n== recuperacion ==')
const recuperado = reducerCarta<Carta>(conAviso, { tipo: 'FETCH_OK', clave: claveDeCarta(NEG, 'centro'), datos: { ...CARTA, total: 9 }, ahora: T0 + 7 * 60_000 })
igual('el fetch bueno pisa el cache', cartaDeCache(recuperado, claveDeCarta(NEG, 'centro'))?.datos?.total, 9)
igual('y limpia el aviso', recuperado.aviso, null)
igual('y renueva el timestamp', cartaDeCache(recuperado, claveDeCarta(NEG, 'centro'))?.guardadoEn, T0 + 7 * 60_000)

// --- 10. Refetch manual ----------------------------------------------------
console.log('\n== refetch manual ==')
const manual = reducerCarta<Carta>(seleccionar(conCache(), 'centro', T0 + 60_000), { tipo: 'REFETCH_MANUAL' })
plan = planDeFetch(manual, T0 + 60_000)
igual('pide de nuevo aunque el cache este fresco', [plan.bloqueante, plan.background], [false, true])
igual('pero sin bloquear la pantalla', manual.cargando, false)

console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
if (fallas.length > 0) { console.log(fallas.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
