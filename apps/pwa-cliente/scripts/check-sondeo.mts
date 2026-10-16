/**
 * Check de las CADENCIAS de sondeo (lib/sondeo.ts).
 *
 *   node scripts/check-sondeo.mts
 *
 * Es logica pura (sin React, sin DOM): aca se verifica que la ventana agresiva de la pantalla
 * de espera y el respaldo de la tarjeta produzcan la cantidad de consultas que dicen producir,
 * y que con la pestana OCULTA no salga ninguna. El cableado a los hooks (setInterval/setTimeout
 * y `document.visibilityState`) se verifica en el navegador: es scheduling, no dominio.
 */
import {
  RESPALDO_TARJETA_MS,
  SONDEO_INICIAL_MS,
  SONDEO_TARDIO_MS,
  TICK_RESPALDO_TARJETA_MS,
  TOPE_SONDEO_MS,
  VENTANA_INICIAL_MS,
  debeRefrescarRespaldo,
  intervaloDeSondeo,
  sondeoVencido,
} from '../lib/sondeo.ts'

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

/* ------------------------------------------------------------------ *
 * Pantalla de espera (useVisitaQr)
 * ------------------------------------------------------------------ */

console.log('--- pantalla de espera del club (sondeo de la visita) ---')

igual('arranque: sondea rapido (2,5 s)', intervaloDeSondeo(0), SONDEO_INICIAL_MS)
igual('a los 29,9 s sigue rapido', intervaloDeSondeo(VENTANA_INICIAL_MS - 1), SONDEO_INICIAL_MS)
igual('a los 30 s exactos ya es tranquilo', intervaloDeSondeo(VENTANA_INICIAL_MS), SONDEO_TARDIO_MS)
igual('bien entrada la espera sigue tranquilo', intervaloDeSondeo(120_000), SONDEO_TARDIO_MS)
chk('el intervalo de la ventana es de 2 a 3 segundos', SONDEO_INICIAL_MS >= 2000 && SONDEO_INICIAL_MS <= 3000)
chk('el intervalo tardio es mas tranquilo que el inicial', SONDEO_TARDIO_MS > SONDEO_INICIAL_MS)
chk('la ventana alcanza para ~12 sondeos rapidos', Math.floor(VENTANA_INICIAL_MS / SONDEO_INICIAL_MS) >= 10)
chk('el tope del respaldo cubre la vida del token (5 min)', TOPE_SONDEO_MS === 300_000)
chk('al tope todavia no vencio', !sondeoVencido(TOPE_SONDEO_MS))
chk('pasado el tope si vencio', sondeoVencido(TOPE_SONDEO_MS + 1))

/**
 * Simula el respaldo: el polling arranca a los 3 s (la gracia del WS), cada consulta tarda 1,4 s
 * (latencia cruzada) y el proximo tick se programa al arrancar la consulta, con la cadencia de
 * `intervaloDeSondeo` medida desde que se pidio la visita.
 */
function simularSondeoVisita(duracionMs: number) {
  const t0 = 0
  const arranque = 3000
  let t = arranque
  const inicios: number[] = []
  while (t <= duracionMs) {
    inicios.push(t)
    t += intervaloDeSondeo(t - t0)
  }
  return inicios
}

const sondeos40s = simularSondeoVisita(40_000)
const primeros30 = sondeos40s.filter((t) => t - 3000 < VENTANA_INICIAL_MS)
igual('en los primeros 30 s de espera salen 12 sondeos (uno cada 2,5 s)', primeros30.length, 12)
const brechas = sondeos40s.slice(1).map((t, i) => t - sondeos40s[i]!)
igual('las brechas son 2,5 s y despues 5 s (nunca 5 s en la ventana agresiva)',
  [...new Set(brechas)].sort((a, b) => a - b), [SONDEO_INICIAL_MS, SONDEO_TARDIO_MS])
igual('a los 40 s ya hay 13 sondeos en total (12 rapidos + 1 tranquilo)', sondeos40s.length, 13)

/* ------------------------------------------------------------------ *
 * Tarjeta (useMiTarjeta)
 * ------------------------------------------------------------------ */

console.log('\n--- respaldo de la tarjeta ---')

igual('el tick despierta a la mitad del intervalo', TICK_RESPALDO_TARJETA_MS, RESPALDO_TARJETA_MS / 2)
chk('el tick no pega al backend (es menor que el intervalo)', TICK_RESPALDO_TARJETA_MS < RESPALDO_TARJETA_MS)
chk('el intervalo es de 8 a 10 s', RESPALDO_TARJETA_MS >= 8000 && RESPALDO_TARJETA_MS <= 10_000)

/** Simula N ms de vida del componente: el tick despierta y solo consulta si toca. */
function simularRespaldoTarjeta(duracionMs: number, visible: boolean, primerRefrescoMs: number) {
  let ultimoRefresco = primerRefrescoMs
  const consultas: number[] = []
  for (let ahora = TICK_RESPALDO_TARJETA_MS; ahora <= duracionMs; ahora += TICK_RESPALDO_TARJETA_MS) {
    if (!debeRefrescarRespaldo(ahora, ultimoRefresco, visible)) continue
    consultas.push(ahora)
    ultimoRefresco = ahora
  }
  return consultas
}

const tarjetaVisible = simularRespaldoTarjeta(60_000, true, 0)
igual('con la pestana visible salen 6 consultas en 60 s', tarjetaVisible.length, 6)
igual('y son cada 10 s, no cada 5 s', tarjetaVisible.slice(1).map((t, i) => t - tarjetaVisible[i]!), [
  RESPALDO_TARJETA_MS,
  RESPALDO_TARJETA_MS,
  RESPALDO_TARJETA_MS,
  RESPALDO_TARJETA_MS,
  RESPALDO_TARJETA_MS,
])
const tarjetaOculta = simularRespaldoTarjeta(60_000, false, 0)
igual('con la pestana OCULTA no sale ninguna consulta', tarjetaOculta.length, 0)

// El WS acaba de traer el cambio (t=47,5 s): el proximo respaldo tiene que ESPERAR un intervalo
// completo, no duplicar el trabajo.
const sinDuplicar = debeRefrescarRespaldo(50_000, 47_500, true)
chk('un refresco del WS corre el proximo sondeo un intervalo', !sinDuplicar)
chk('y el sondeo vuelve a salir pasado el intervalo', debeRefrescarRespaldo(57_500, 47_500, true))
chk('un WS reciente NO refuerza el sondeo con la pestana oculta', !debeRefrescarRespaldo(120_000, 0, false))

console.log(`\n  TOTAL: ${ok} OK, ${fallas.length} FALLA`)
if (fallas.length) {
  console.log('  FALLARON: ' + fallas.join(' | '))
  process.exit(1)
}
