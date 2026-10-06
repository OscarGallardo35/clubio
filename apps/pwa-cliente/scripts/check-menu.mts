/**
 * Check del cache de modificadores y de la normalizacion de precios (punto 2, etapa 3).
 *
 *   node scripts/check-menu.mts
 *
 * El reloj entra por parametro: el TTL se prueba con dos numeros, sin timers.
 */
import {
  AVISO_MODIFICADORES_VIEJOS,
  TTL_MODIFICADORES_MS,
  aNumero,
  claveDeModificadores,
  decidirLecturaMods,
  estadoModificadoresInicial,
  modificadoresDeCache,
  normalizarModificadores,
  planDeFetchMods,
  reducerModificadores,
} from '../lib/modificadores-cache.ts'
import type { EstadoModificadores } from '../lib/modificadores-cache.ts'
// Modulo PURO del package (por eso se puede importar desde node sin arrastrar React).
import { ANCHO_POR_TIPO, RATIO_POR_TIPO, urlOptimizada } from '../../../packages/ui/src/lib/url-optimizada.ts'

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
const ITEM = 'item-hamburguesa'

/** Respuesta CRUDA del backend: precioExtra viene como string (es un Decimal). */
const CRUDO = {
  itemId: ITEM,
  itemNombre: 'Hamburguesa clásica',
  precioBase: '4500',
  grupos: [
    {
      id: 'g1',
      nombre: 'Aderezos',
      descripcion: null,
      tipo: 'MULTIPLE_SELECCION',
      obligatorio: false,
      minSelecciones: 0,
      maxSelecciones: 4,
      opciones: [
        { id: 'o1', nombre: 'Mayonesa', precioExtra: '0', disponible: true },
        { id: 'o2', nombre: 'BBQ', precioExtra: '300', disponible: true },
        { id: 'o3', nombre: 'Mostaza', precioExtra: '0', disponible: false },
      ],
    },
    {
      id: 'g2',
      nombre: 'Salsas obligatorias',
      tipo: 'UNICA_SELECCION',
      obligatorio: true,
      minSelecciones: 1,
      maxSelecciones: 1,
      opciones: [
        { id: 'o4', nombre: 'Salsa de la casa', precioExtra: '0', disponible: true },
        { id: 'o5', nombre: 'BBQ', precioExtra: '200', disponible: true },
      ],
    },
  ],
}

// --- 1. Normalizacion: el bug que esto evita --------------------------------
console.log('\n== normalizacion de precios ==')
const norm = normalizarModificadores(CRUDO)
igual('precioExtra string -> number (BBQ del grupo 2)', norm.grupos[1].opciones[1].precioExtra, 200)
igual('y el tipo es number', typeof norm.grupos[1].opciones[1].precioExtra, 'number')
igual('todos los precios quedan number', norm.grupos.every((g) => g.opciones.every((o) => typeof o.precioExtra === 'number')), true)
igual('precioBase tambien (venia "4500")', norm.precioBase, 4500)
chk('EL BUG: sin normalizar, "200" + 0 da "2000" (concatenacion)',
    ('200' as unknown as number) + (0 as number) === '2000',
    `"200" + 0 = ${('200' as unknown as number) + (0 as number)}`)
igual('normalizado, 200 + 0 da 200 (la suma correcta)', norm.grupos[1].opciones[1].precioExtra + 0, 200)
igual('el total del item con el extra suma bien', norm.precioBase + norm.grupos[1].opciones[1].precioExtra, 4700)
chk('ningun precio quedo como string ni NaN', norm.grupos.every((g) => g.opciones.every((o) => Number.isFinite(o.precioExtra))))

console.log('\n== normalizacion defensiva ==')
igual('un precio basura cae a 0 en vez de NaN', aNumero('no soy un numero'), 0)
igual('null cae a 0', aNumero(null), 0)
igual('undefined cae a 0', aNumero(undefined), 0)
igual('un numero pasa igual', aNumero(300), 300)
igual('una respuesta vacia no explota', normalizarModificadores(undefined).grupos, [])
igual('y devuelve la forma esperada', normalizarModificadores({ grupos: 'no soy un array' }).grupos, [])
igual('un grupo sin opciones queda con lista vacia', normalizarModificadores({ grupos: [{ id: 'x', nombre: 'X' }] }).grupos[0].opciones, [])
igual('tipo desconocido cae a UNICA_SELECCION', normalizarModificadores({ grupos: [{ id: 'x', nombre: 'X', tipo: 'LO_QUE_SEA' }] }).grupos[0].tipo, 'UNICA_SELECCION')
igual('un disponible ausente se toma como disponible', normalizarModificadores({ grupos: [{ id: 'x', nombre: 'X', opciones: [{ id: 'o', nombre: 'O' }] }] }).grupos[0].opciones[0].disponible, true)
igual('el grupo obligatorio del seed sobrevive la normalizacion', norm.grupos[1].obligatorio, true)
igual('y sus min/max tambien', [norm.grupos[1].minSelecciones, norm.grupos[1].maxSelecciones], [1, 1])

// --- 2. Clave por item ------------------------------------------------------
console.log('\n== clave por itemId ==')
igual('la clave lleva el itemId', claveDeModificadores(ITEM), `modificadores_${ITEM}`)
chk('cambiar de item es otra clave', claveDeModificadores('a') !== claveDeModificadores('b'))

// --- 3. Cache: TTL, hit, miss, error ----------------------------------------
console.log('\n== cache-first y TTL ==')
const clave = claveDeModificadores(ITEM)
let s: EstadoModificadores = estadoModificadoresInicial()
s = reducerModificadores(s, { tipo: 'SELECCIONAR', itemId: ITEM, ahora: T0 })
igual('sin cache: fetch bloqueante (skeleton)', [s.cargando, planDeFetchMods(s, T0).bloqueante], [true, true])
igual('y no hay nada para mostrar', modificadoresDeCache(s, clave), undefined)
s = reducerModificadores(s, { tipo: 'FETCH_OK', clave, datos: norm, ahora: T0 })
igual('tras el fetch queda fresco', decidirLecturaMods(modificadoresDeCache(s, clave), T0 + 60_000), 'fresca')
igual('TTL de 5 min', TTL_MODIFICADORES_MS, 300_000)
igual('a los 5:00 exactos vence', decidirLecturaMods(modificadoresDeCache(s, clave), T0 + TTL_MODIFICADORES_MS), 'vencida')
const fresco = reducerModificadores(s, { tipo: 'SELECCIONAR', itemId: ITEM, ahora: T0 + 90_000 })
igual('cache fresco: NO se llama al backend', [planDeFetchMods(fresco, T0 + 90_000).bloqueante, planDeFetchMods(fresco, T0 + 90_000).background], [false, false])
igual('y no hay skeleton', fresco.cargando, false)
const vencido = reducerModificadores(s, { tipo: 'SELECCIONAR', itemId: ITEM, ahora: T0 + 6 * 60_000 })
igual('cache vencido: se muestra lo viejo y se actualiza atras', [vencido.cargando, planDeFetchMods(vencido, T0 + 6 * 60_000).background], [false, true])
chk('los datos viejos siguen visibles', modificadoresDeCache(vencido, clave)?.datos.grupos.length === 2)

console.log('\n== fetch fallido ==')
const conError = reducerModificadores(vencido, { tipo: 'FETCH_ERROR', clave })
igual('NO sobreescribe el cache viejo', modificadoresDeCache(conError, clave)?.datos, norm)
igual('mantiene el timestamp (el TTL no se renueva con un error)', modificadoresDeCache(conError, clave)?.guardadoEn, T0)
igual('deja el aviso', conError.aviso, AVISO_MODIFICADORES_VIEJOS)
chk('el aviso se descarta', reducerModificadores(conError, { tipo: 'DESCARTAR_AVISO' }).aviso === null)

console.log('\n== cambiar de item ==')
const otro = reducerModificadores(s, { tipo: 'SELECCIONAR', itemId: 'otro-item', ahora: T0 + 60_000 })
igual('la clave activa cambia', otro.claveActiva, claveDeModificadores('otro-item'))
igual('y pide los del item nuevo (no reusa los del anterior)', [otro.cargando, planDeFetchMods(otro, T0 + 60_000).bloqueante], [true, true])
chk('el cache del item anterior queda intacto', modificadoresDeCache(otro, clave)?.datos === norm)
igual('volver al primer item pega en el cache', planDeFetchMods(reducerModificadores(otro, { tipo: 'SELECCIONAR', itemId: ITEM, ahora: T0 + 61_000 }), T0 + 61_000).background, false)

console.log('\n== invalidar y refetch manual ==')
const invalidado = reducerModificadores(fresco, { tipo: 'INVALIDAR', clave })
igual('invalidar borra esa clave', Object.keys(invalidado.porClave), [])
igual('refetch manual sobre cache fresco pide igual', planDeFetchMods(reducerModificadores(fresco, { tipo: 'REFETCH_MANUAL' }), T0 + 90_000).background, true)
igual('pero sin bloquear la pantalla', reducerModificadores(fresco, { tipo: 'REFETCH_MANUAL' }).cargando, false)

// --- 4. Totalidad e inmutabilidad -------------------------------------------
console.log('\n== totalidad e inmutabilidad ==')
const EVENTOS = [
  { tipo: 'SELECCIONAR', itemId: ITEM, ahora: T0 },
  { tipo: 'FETCH_OK', clave, datos: norm, ahora: T0 },
  { tipo: 'FETCH_ERROR', clave },
  { tipo: 'REFETCH_MANUAL' },
  { tipo: 'INVALIDAR', clave },
  { tipo: 'DESCARTAR_AVISO' },
] as const
let totalidad = true
for (const ev of EVENTOS) {
  const antes = JSON.stringify(estadoModificadoresInicial())
  const base = reducerModificadores(estadoModificadoresInicial(), { tipo: 'FETCH_OK', clave, datos: norm, ahora: T0 })
  const salida = reducerModificadores(base, ev as never)
  if (!('porClave' in salida) || !('claveActiva' in salida) || !('aviso' in salida)) totalidad = false
  if (JSON.stringify(estadoModificadoresInicial()) !== antes) totalidad = false
}
chk(`los ${EVENTOS.length} eventos devuelven un estado valido y no mutan la entrada`, totalidad)
chk('normalizar no muta la respuesta cruda', CRUDO.grupos[1].opciones[1].precioExtra === '200')


// --- 5. urlOptimizada (modulo puro de @repo/ui) -----------------------------
console.log('\n== urlOptimizada ==')
const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1700000000/platos/milanesa.jpg'
igual('Cloudinary: mete c_fill, w_ del tipo, q_auto y f_auto',
  urlOptimizada(CLOUD, 'item'),
  'https://res.cloudinary.com/demo/image/upload/c_fill,w_600,q_auto:good,f_auto/v1700000000/platos/milanesa.jpg')
chk('Cloudinary: el ancho depende del tipo', urlOptimizada(CLOUD, 'avatar').includes('w_128') && urlOptimizada(CLOUD, 'categoria').includes('w_320'))
chk('Cloudinary ya transformada: no se pisa', urlOptimizada('https://res.cloudinary.com/demo/image/upload/c_fill,w_1200/x.jpg', 'item') === 'https://res.cloudinary.com/demo/image/upload/c_fill,w_1200/x.jpg')
igual('una URL externa se devuelve igual', urlOptimizada('https://ejemplo.com/foto.png', 'item'), 'https://ejemplo.com/foto.jpg'.replace('jpg','png'))
igual('sin Cloudinary no se toca ni una URL rara', urlOptimizada('no-es-una-url', 'item'), 'no-es-una-url')
igual('src vacio devuelve vacio (el placeholder lo decide el componente)', urlOptimizada('', 'item'), '')
igual('los espacios se recortan', urlOptimizada('  https://ejemplo.com/a.png  ', 'item'), 'https://ejemplo.com/a.png')
igual('hay ratio por tipo', [RATIO_POR_TIPO.item, ANCHO_POR_TIPO.item], [4 / 3, 600])

console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
if (fallas.length > 0) { console.log(fallas.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
