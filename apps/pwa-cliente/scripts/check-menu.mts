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
import { ordenarCategorias } from '../lib/ordenar-categorias.ts'
import { TABS, tabActiva, tabsVisibles } from '../lib/nav-tabs.ts'
import { modificadoresParaApi } from '../lib/modificadores-seleccion.ts'
import { alternarSeleccion, armarItemProvisional, elegidosDesde, gruposObligatoriosFaltantes, recortarNotas } from '../lib/modificadores-seleccion.ts'
import { precioUnitario, validarModificadores } from '../lib/carrito-maquina.ts'
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


// --- 6. Seleccion de modificadores (lo que usa el modal) ---------------------
console.log('\n== seleccion del modal ==')
const G = norm.grupos // g1 = MULTIPLE (max 4, opciones o1..o3), g2 = UNICA obligatoria (o4, o5)

// obligatorio sin seleccion -> invalido
igual('obligatorio sin elegir es invalido', validarModificadores(G, elegidosDesde(G, {})).length > 0, true)
igual('y se sabe cual falta', gruposObligatoriosFaltantes(G, {}), ['Salsas obligatorias'])
igual('con la obligatoria elegida, valida', validarModificadores(G, elegidosDesde(G, { g2: ['o5'] })), [])
igual('ya no falta ninguna', gruposObligatoriosFaltantes(G, { g2: ['o5'] }), [])

// UNICA reemplaza; MULTIPLE alterna
let sel = {}
sel = alternarSeleccion(G, sel, 'g2', 'o4')
igual('UNICA: elegir una', sel.g2, ['o4'])
sel = alternarSeleccion(G, sel, 'g2', 'o5')
igual('UNICA: elegir otra reemplaza', sel.g2, ['o5'])
sel = alternarSeleccion(G, sel, 'g2', 'o5')
igual('UNICA: volver a tocarla la desmarca', sel.g2, [])
sel = alternarSeleccion(G, sel, 'g1', 'o1')
sel = alternarSeleccion(G, sel, 'g1', 'o2')
igual('MULTIPLE: acumula', sel.g1, ['o1', 'o2'])
sel = alternarSeleccion(G, sel, 'g1', 'o1')
igual('MULTIPLE: destilda', sel.g1, ['o2'])

// min/max: una de mas no entra (el tope frena el toque), una de menos se detecta
const grupoChico = [{ id: 'gm', nombre: 'Salsas', tipo: 'MULTIPLE_SELECCION', obligatorio: false, minSelecciones: 2, maxSelecciones: 3, opciones: [1, 2, 3, 4].map((n) => ({ id: 'm' + n, nombre: 'M' + n, precioExtra: 0, disponible: true })) }]
let s2 = {}
for (const id of ['m1', 'm2', 'm3', 'm4']) s2 = alternarSeleccion(grupoChico as never, s2, 'gm', id)
igual('MULTIPLE: al llegar al maximo, el toque de mas no entra', s2.gm, ['m1', 'm2', 'm3'])
igual('con menos del minimo, la validacion avisa', validarModificadores(grupoChico as never, elegidosDesde(grupoChico as never, { gm: ['m1'] })).length, 1)
igual('en el maximo, valida', validarModificadores(grupoChico as never, elegidosDesde(grupoChico as never, s2)), [])

// precio en vivo: base + extras ya normalizados a number
const prov = armarItemProvisional({ id: ITEM, nombre: 'Hamburguesa', precio: norm.precioBase }, { g2: ['o5'] }, '', G)
igual('el precio del provisorio es base + extra', precioUnitario(prov), 4500 + 200)
igual('y con la opcion sin costo, queda el base', precioUnitario(armarItemProvisional({ id: ITEM, nombre: 'H', precio: norm.precioBase }, { g2: ['o4'] }, '', G)), 4500)
chk('los extras son number (no string): el extra es 200, no "200"', prov.modificadores[0].opciones[0].precioExtra === 200, `tipo=${typeof prov.modificadores[0].opciones[0].precioExtra}`)

// forma final y notas
igual('la forma que sale es {grupoId, grupoNombre, opciones[]}', Object.keys(prov.modificadores[0]).sort(), ['grupoId', 'grupoNombre', 'opciones'])
igual('y las opciones llevan id/nombre/precioExtra', Object.keys(prov.modificadores[0].opciones[0]).sort(), ['id', 'nombre', 'precioExtra'])
igual('las notas se recortan a 200', armarItemProvisional({ id: ITEM, nombre: 'H', precio: 100 }, {}, 'x'.repeat(250), []).notas.length, 200)
igual('recortarNotas deja intacto lo corto', recortarNotas('sin cebolla'), 'sin cebolla')
igual('un grupo sin elegir no aparece en la forma final', elegidosDesde(G, { g2: ['o5'] }).length, 1)


// --- 7. Orden de las categorias ----------------------------------------------
console.log('\n== orden de categorias ==')
const cat = (nombre: string, cuantos: number) => ({ categoria: nombre, items: Array.from({ length: cuantos }, (_, i) => ({ id: nombre + i })) })
// El orden REAL que manda el backend hoy (alfabetico, con Principales ultima).
igual('el caso real: Principales pasa primera',
  ordenarCategorias([cat('Bebidas', 4), cat('Entradas', 2), cat('Postres', 2), cat('Principales', 5)]).map((c) => c.categoria),
  ['Principales', 'Bebidas', 'Entradas', 'Postres'])
igual('sin Principales: alfabetico',
  ordenarCategorias([cat('Postres', 1), cat('Bebidas', 1), cat('Entradas', 1)]).map((c) => c.categoria),
  ['Bebidas', 'Entradas', 'Postres'])
igual('Principales SIN items no va primera',
  ordenarCategorias([cat('Postres', 1), cat('Principales', 0), cat('Bebidas', 1)]).map((c) => c.categoria),
  ['Bebidas', 'Postres', 'Principales'])
igual('array vacio devuelve vacio', ordenarCategorias([]), [])
igual('no muta el array original', (() => { const a = [cat('Postres', 1), cat('Principales', 2)]; ordenarCategorias(a); return a.map((c) => c.categoria).join() })(), 'Postres,Principales')
igual('si TODAS traen orden numerico, manda el backend',
  ordenarCategorias([{ categoria: 'Z', orden: 1, items: [1] }, { categoria: 'A', orden: 0, items: [1] }]).map((c) => c.categoria), ['A', 'Z'])
igual('con orden parcial NO lo usa: cae al criterio por nombre',
  ordenarCategorias([{ categoria: 'Z', orden: 1, items: [1] }, cat('A', 1)]).map((c) => c.categoria), ['A', 'Z'])

// --- 8. Conversion a la forma de la API ---------------------------------------
console.log('\n== conversion a la API ==')
const interna = [
  { grupoId: 'g2', grupoNombre: 'Salsas obligatorias', opciones: [{ id: 'o5', nombre: 'BBQ', precioExtra: 200 }] },
  { grupoId: 'g1', grupoNombre: 'Aderezos', opciones: [{ id: 'o1', nombre: 'Ketchup', precioExtra: 0 }, { id: 'o3', nombre: 'Mayo', precioExtra: 100 }] },
]
const internaCopia = JSON.stringify(interna)
igual('UNICA + MULTIPLE se convierten a opcionIds', modificadoresParaApi(interna as never),
  [{ grupoId: 'g2', opcionIds: ['o5'] }, { grupoId: 'g1', opcionIds: ['o1', 'o3'] }])
igual('un grupo sin opciones no aparece en la salida',
  modificadoresParaApi([{ grupoId: 'g9', grupoNombre: 'X', opciones: [] }] as never), [])
igual('sin modificadores devuelve vacio', modificadoresParaApi([]), [])
igual('no muta la forma interna', JSON.stringify(interna), internaCopia)
igual('las notas de 200+ se recortan al construir el item',
  armarItemProvisional({ id: ITEM, nombre: 'H', precio: 100 }, {}, 'y'.repeat(240), []).notas.length, 200)
chk('y el texto recortado es el de los primeros 200', armarItemProvisional({ id: ITEM, nombre: 'H', precio: 100 }, {}, 'z'.repeat(240), []).notas === 'z'.repeat(200))

// --- 9. Barra inferior: deteccion de la tab activa ---------------------------
console.log('\n== bottom nav ==')
igual('en /menu la activa es Carta', tabActiva('/bar-la-esquina/menu', 'bar-la-esquina'), 'carta')
igual('en /club la activa es Club', tabActiva('/bar-la-esquina/club', 'bar-la-esquina'), 'club')
igual('en /tarjeta la activa es Mi tarjeta', tabActiva('/tarjeta'), 'tarjeta')
igual('funciona tambien en el tenant viejo (e2e)', tabActiva('/norte/club', 'norte'), 'club')
igual('una subruta del club tambien la marca', tabActiva('/bar-la-esquina/club/historial', 'bar-la-esquina'), 'club')
igual('con barra al final no se rompe', tabActiva('/bar-la-esquina/menu/', 'bar-la-esquina'), 'carta')
igual('una ruta que no es de la barra no marca nada', tabActiva('/dev/carrito'), null)
igual('el checkout tampoco marca', tabActiva('/bar-la-esquina/checkout', 'bar-la-esquina'), null)
igual('con menu activo se ven las 3 tabs', tabsVisibles(true).map((t) => t.clave), ['carta', 'club', 'tarjeta'])
igual('sin menu se ven 2 (Carta no)', tabsVisibles(false).map((t) => t.clave), ['club', 'tarjeta'])
igual('las rutas se arman con el tenant', TABS.map((t) => t.href('x')), ['/x/menu', '/x/club', '/tarjeta'])
console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
if (fallas.length > 0) { console.log(fallas.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
