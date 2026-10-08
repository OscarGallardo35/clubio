/**
 * Check de la maquina de estados del flujo QR #2.
 *
 * Corre en node pelado (sin Vitest, sin jsdom, sin browser):
 *
 *   node scripts/check-visita-maquina.ts
 *
 * Verifica transiciones, las reglas de diseño (nunca reintentar solo, la
 * aprobacion gana, EXPIRAR no pisa un exito), totalidad e inmutabilidad.
 */
import {
  ESTADO_INICIAL,
  clasificarRechazoDeSolicitud,
  PASOS,
  TIPOS_DE_EVENTO,
  esFinal,
  puedeReintentar,
  textoDelMotivo,
  visitaReducir,
  resumenDeAprobacion,
  eventoDeAprobacion,
} from '../lib/visita-maquina.ts'
import type { VisitaAprobadaPayload } from '@repo/api-client'
import { tipoDeTarjeta, vistaDeTarjeta } from '../lib/tarjeta.ts'
import type { MiTarjetaRespuesta } from '../types/api.ts'
import type { EstadoFlujo, EventoFlujo, Paso } from '../lib/visita-maquina.ts'

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

/** Estado de partida en un paso dado, para probar cada transicion aislada. */
function en(paso: Paso, extra: Partial<EstadoFlujo> = {}): EstadoFlujo {
  return { ...ESTADO_INICIAL, paso, ...extra }
}

// Un evento de muestra por tipo: alimenta los tests de totalidad e inmutabilidad.
const EVENTOS: Record<(typeof TIPOS_DE_EVENTO)[number], EventoFlujo> = {
  ABRIR_REGISTRO: { tipo: 'ABRIR_REGISTRO' },
  CERRAR_REGISTRO: { tipo: 'CERRAR_REGISTRO' },
  SOLICITAR: { tipo: 'SOLICITAR' },
  SOLICITADA: { tipo: 'SOLICITADA', token: 'tok-1', expiraEn: '2026-10-06T03:00:00.000Z', sucursalId: 'suc-1' },
  SOLICITUD_RECHAZADA: { tipo: 'SOLICITUD_RECHAZADA', motivo: 'esperaHoras', faltanHoras: 4 },
  ESTADO_RECIBIDO: { tipo: 'ESTADO_RECIBIDO', estado: 'PENDIENTE' },
  WS_APROBADA: { tipo: 'WS_APROBADA', sellosActuales: 4, premioDesbloqueado: false },
  WS_RECHAZADA: { tipo: 'WS_RECHAZADA', motivo: 'QR ya usado' },
  EXPIRAR: { tipo: 'EXPIRAR' },
  REINTENTAR: { tipo: 'REINTENTAR' },
  ERROR_RED: { tipo: 'ERROR_RED', mensaje: 'sin red' },
  RESET: { tipo: 'RESET' },
}

console.log('=== 1. estado inicial ===')
igual('arranca en inicio', ESTADO_INICIAL.paso, 'inicio')
igual('sin token', ESTADO_INICIAL.token, null)
chk('no es final', !esFinal(ESTADO_INICIAL))
chk('no se puede reintentar', !puedeReintentar(ESTADO_INICIAL))
igual('no hay texto de motivo', textoDelMotivo(ESTADO_INICIAL), null)

console.log('\n=== 2. camino feliz ===')
let e = visitaReducir(ESTADO_INICIAL, { tipo: 'ABRIR_REGISTRO' })
igual('ABRIR_REGISTRO -> registrando', e.paso, 'registrando')
e = visitaReducir(e, { tipo: 'SOLICITAR' })
igual('SOLICITAR -> solicitando', e.paso, 'solicitando')
e = visitaReducir(e, { tipo: 'SOLICITADA', token: 'tok-abc', expiraEn: '2026-10-06T03:05:00.000Z', sucursalId: 'suc-norte' })
igual('SOLICITADA -> esperando', e.paso, 'esperando')
igual('guarda el token', e.token, 'tok-abc')
igual('guarda la sucursal', e.sucursalId, 'suc-norte')
igual('no viene de reanudar', e.reanudado, false)
e = visitaReducir(e, { tipo: 'WS_APROBADA', sellosActuales: 5, premioDesbloqueado: false })
igual('WS_APROBADA -> aprobada', e.paso, 'aprobada')
igual('sellos del payload (fuente de verdad)', e.sellos, { sellosActuales: 5, premioDesbloqueado: false })
chk('aprobada es final', esFinal(e))
chk('aprobada no ofrece reintentar', !puedeReintentar(e))

console.log('\n=== 3. sellos y premio en el payload del WS ===')
const aprobadoConPremio = visitaReducir(en('esperando', { token: 't' }), { tipo: 'WS_APROBADA', sellosActuales: 10, premioDesbloqueado: true })
igual('premioDesbloqueado se propaga', aprobadoConPremio.sellos, { sellosActuales: 10, premioDesbloqueado: true })

console.log('\n=== 4. polling (estado/:token) ===')
igual('PENDIENTE se queda esperando', visitaReducir(en('esperando'), { tipo: 'ESTADO_RECIBIDO', estado: 'PENDIENTE' }).paso, 'esperando')
igual('PENDIENTE marca reanudado', visitaReducir(en('inicio'), { tipo: 'ESTADO_RECIBIDO', estado: 'PENDIENTE' }).reanudado, true)
igual('APROBADA por polling', visitaReducir(en('esperando'), { tipo: 'ESTADO_RECIBIDO', estado: 'APROBADA', sellosActuales: 7 }).paso, 'aprobada')
igual('APROBADA por polling toma los sellos', visitaReducir(en('esperando'), { tipo: 'ESTADO_RECIBIDO', estado: 'APROBADA', sellosActuales: 7 }).sellos, { sellosActuales: 7, premioDesbloqueado: false })
const rec = visitaReducir(en('esperando'), { tipo: 'ESTADO_RECIBIDO', estado: 'RECHAZADA', motivo: 'QR ya usado' })
igual('RECHAZADA -> noSumada', rec.paso, 'noSumada')
igual('motivo rechazada', rec.motivo, 'rechazada')
igual('guarda el motivo del backend', rec.mensaje, 'QR ya usado')
const exp = visitaReducir(en('esperando'), { tipo: 'ESTADO_RECIBIDO', estado: 'EXPIRADA' })
igual('EXPIRADA -> noSumada/expirada', [exp.paso, exp.motivo], ['noSumada', 'expirada'])

console.log('\n=== 5. regla: NUNCA reintentar solo ===')
igual('ESTADO_RECIBIDO se IGNORA desde noSumada', visitaReducir(en('noSumada', { motivo: 'expirada' }), { tipo: 'ESTADO_RECIBIDO', estado: 'PENDIENTE' }).paso, 'noSumada')
igual('EXPIRAR no toca aprobada (no pisa un exito)', visitaReducir(en('aprobada'), { tipo: 'EXPIRAR' }).paso, 'aprobada')
igual('EXPIRAR no toca noSumada', visitaReducir(en('noSumada', { motivo: 'expirada' }), { tipo: 'EXPIRAR' }).paso, 'noSumada')
igual('ERROR_RED no pisa una aprobada', visitaReducir(en('aprobada'), { tipo: 'ERROR_RED', mensaje: 'x' }).paso, 'aprobada')
igual('REINTENTAR no hace nada en aprobada', visitaReducir(en('aprobada'), { tipo: 'REINTENTAR' }).paso, 'aprobada')
igual('REINTENTAR no hace nada en esperando', visitaReducir(en('esperando'), { tipo: 'REINTENTAR' }).paso, 'esperando')

console.log('\n=== 6. regla: la aprobacion GANA (carrera WS vs contador) ===')
igual('WS_APROBADA pisa un "expiro"', visitaReducir(en('noSumada', { motivo: 'expirada' }), { tipo: 'WS_APROBADA', sellosActuales: 6, premioDesbloqueado: false }).paso, 'aprobada')
igual('WS_APROBADA desde inicio (reanudar)', visitaReducir(en('inicio'), { tipo: 'WS_APROBADA', sellosActuales: 9, premioDesbloqueado: true }).paso, 'aprobada')

console.log('\n=== 7. 400 del backend con texto propio ===')
const espera = visitaReducir(en('solicitando'), { tipo: 'SOLICITUD_RECHAZADA', motivo: 'esperaHoras', faltanHoras: 4 })
igual('esperaHoras -> noSumada', [espera.paso, espera.motivo], ['noSumada', 'esperaHoras'])
igual('guardadas las horas que faltan', espera.faltanHoras, 4)
igual('texto de espera (copy del usuario)', textoDelMotivo(espera), 'Ya sumaste hoy. Volvé en 4 horas para tu próxima visita.')
const limite = visitaReducir(en('solicitando'), { tipo: 'SOLICITUD_RECHAZADA', motivo: 'yaSumadaHoy' })
igual('limite diario -> noSumada/yaSumadaHoy', [limite.paso, limite.motivo], ['noSumada', 'yaSumadaHoy'])
igual('texto de ya sumaste', textoDelMotivo(limite), 'Ya sumaste hoy, mirá tu tarjeta.')
const otro = visitaReducir(en('solicitando'), { tipo: 'SOLICITUD_RECHAZADA', motivo: 'otro', mensaje: 'boom' })
igual('otro 400 si es error', [otro.paso, otro.mensaje], ['error', 'boom'])
igual('texto de expirada invita a reintentar', textoDelMotivo(en('noSumada', { motivo: 'expirada' })), 'La solicitud expiró, ¿querés intentar de nuevo?')
igual('texto de 1 hora en singular', textoDelMotivo(en('noSumada', { motivo: 'esperaHoras', faltanHoras: 1 })), 'Ya sumaste hoy. Volvé en 1 hora para tu próxima visita.')

console.log('\n=== 8. REINTENTAR (accion explicita) ===')
const re1 = visitaReducir(en('noSumada', { motivo: 'expirada', mensaje: 'x' }), { tipo: 'REINTENTAR' })
igual('REINTENTAR -> solicitando', re1.paso, 'solicitando')
igual('limpia motivo', re1.motivo, null)
igual('limpia mensaje', re1.mensaje, null)
igual('REINTENTAR desde error -> solicitando', visitaReducir(en('error', { mensaje: 'x' }), { tipo: 'REINTENTAR' }).paso, 'solicitando')

console.log('\n=== 9. no se pide dos veces la misma visita ===')
igual('SOLICITAR en esperando es no-op', visitaReducir(en('esperando', { token: 't' }), { tipo: 'SOLICITAR' }).paso, 'esperando')
igual('SOLICITAR en solicitando es no-op', visitaReducir(en('solicitando'), { tipo: 'SOLICITAR' }).paso, 'solicitando')
igual('SOLICITAR en esperando NO pierde el token', visitaReducir(en('esperando', { token: 't' }), { tipo: 'SOLICITAR' }).token, 't')

console.log('\n=== 10. RESET / registro ===')
const reseteado = visitaReducir(en('noSumada', { motivo: 'rechazada' }), { tipo: 'RESET' })
igual('RESET vuelve a inicio', reseteado.paso, 'inicio')
igual('RESET limpia el token', reseteado.token, null)
igual('CERRAR_REGISTRO vuelve a inicio', visitaReducir(en('registrando'), { tipo: 'CERRAR_REGISTRO' }).paso, 'inicio')
igual('ABRIR_REGISTRO desde aprobada', visitaReducir(en('aprobada'), { tipo: 'ABRIR_REGISTRO' }).paso, 'registrando')

console.log('\n=== 11. totalidad: ningun paso x evento rompe ni devuelve un estado invalido ===')
let combos = 0
let invalidos: string[] = []
for (const paso of PASOS) {
  for (const tipo of TIPOS_DE_EVENTO) {
    combos++
    try {
      const salida = visitaReducir(en(paso), EVENTOS[tipo])
      if (!salida || typeof salida !== 'object') invalidos.push(`${paso} x ${tipo}: no es objeto`)
      else if (!PASOS.includes(salida.paso)) invalidos.push(`${paso} x ${tipo}: paso invalido ${salida.paso}`)
    } catch (err) {
      invalidos.push(`${paso} x ${tipo}: lanzo ${(err as Error).message}`)
    }
  }
}
chk(`${combos} combinaciones (${PASOS.length} pasos x ${TIPOS_DE_EVENTO.length} eventos) sin excepciones ni pasos invalidos`, invalidos.length === 0, invalidos.slice(0, 4).join(' | '))

console.log('\n=== 12. inmutabilidad: el reducer no muta la entrada ===')
let mutados: string[] = []
for (const paso of PASOS) {
  for (const tipo of TIPOS_DE_EVENTO) {
    const original = en(paso, { token: 'tok-x', motivo: 'rechazada', sellos: { sellosActuales: 3, premioDesbloqueado: false } })
    const copia = JSON.parse(JSON.stringify(original))
    visitaReducir(original, EVENTOS[tipo])
    if (JSON.stringify(original) !== JSON.stringify(copia)) mutados.push(`${paso} x ${tipo}`)
  }
}
chk('ninguna combinacion muta el estado de entrada', mutados.length === 0, mutados.slice(0, 4).join(' | '))

console.log('\n=== 13. clasificar el 400 de solicitar (mensajes reales del backend) ===')
igual('mensaje de horas', clasificarRechazoDeSolicitud('Todavia no podes sumar otra visita: espera 4 hora(s) mas'), { motivo: 'esperaHoras', faltanHoras: 4 })
igual('mensaje de limite diario', clasificarRechazoDeSolicitud('Alcanzaste el limite de visitas por dia'), { motivo: 'yaSumadaHoy', faltanHoras: null })
igual('mensaje desconocido -> otro', clasificarRechazoDeSolicitud('Algo salio mal'), { motivo: 'otro', faltanHoras: null })
igual('mensaje vacio -> otro', clasificarRechazoDeSolicitud(''), { motivo: 'otro', faltanHoras: null })
igual('mensaje null -> otro', clasificarRechazoDeSolicitud(null), { motivo: 'otro', faltanHoras: null })
igual('mensaje undefined -> otro', clasificarRechazoDeSolicitud(undefined), { motivo: 'otro', faltanHoras: null })
igual('con acentos igual clasifica', clasificarRechazoDeSolicitud('Todavía no podés sumar otra visita: esperá 2 horas más'), { motivo: 'esperaHoras', faltanHoras: 2 })
igual('1 hora en singular', clasificarRechazoDeSolicitud('Todavia no podes sumar otra visita: espera 1 hora mas'), { motivo: 'esperaHoras', faltanHoras: 1 })
chk('el caso de horas NO cae en otro', clasificarRechazoDeSolicitud('Todavia no podes sumar otra visita: espera 4 hora(s) mas').motivo !== 'otro')

console.log('\n=== 14. eventos desconocidos son identidad ===')
const raro = { tipo: 'EVENTO_QUE_NO_EXISTE' } as unknown as EventoFlujo
const antes = en('esperando', { token: 't' })
igual('evento desconocido no cambia nada', visitaReducir(antes, raro), antes)


console.log('\n== el mensaje de WhatsApp en el flujo ==')
const conSolicitud = visitaReducir(ESTADO_INICIAL, {
  tipo: 'SOLICITADA', token: 'tok-1', expiraEn: new Date(Date.now() + 300000).toISOString(),
  sucursalId: 'suc-1', mensajeWhatsApp: 'Hola, soy Ana. Ref: tok-1', urlValidacion: 'http://staff/validar?ref=tok-1',
})
igual('SOLICITADA guarda el mensaje', conSolicitud.mensajeWhatsApp, 'Hola, soy Ana. Ref: tok-1')
igual('SOLICITADA guarda el link', conSolicitud.urlValidacion, 'http://staff/validar?ref=tok-1')
igual('EXPIRAR los anula (spread: no pasa por ESTADO_INICIAL)',
  [visitaReducir(conSolicitud, { tipo: 'EXPIRAR' }).mensajeWhatsApp, visitaReducir(conSolicitud, { tipo: 'EXPIRAR' }).urlValidacion], [null, null])
igual('RESET los anula via ESTADO_INICIAL',
  [visitaReducir(conSolicitud, { tipo: 'RESET' }).mensajeWhatsApp, visitaReducir(conSolicitud, { tipo: 'RESET' }).urlValidacion], [null, null])


// --- Falta sesion (401) en el flujo ----------------------------------------
console.log('\n== 401 (falta sesion) ==')
// El api-client tira `ApiError(401, undefined, 'No autorizado')`. El clasificador de rechazos no
// conoce ese mensaje, asi que cae en 'otro'... y 'otro' manda a la pantalla de error: ahi estaba el
// bug (un cliente sin sesion veia "Algo salio mal / No autorizado" y un "Reintentar" que volvia a
// pegarle sin sesion, en vez del formulario de registro).
igual('el mensaje del 401 no matchea ningun rechazo del negocio',
  clasificarRechazoDeSolicitud('No autorizado'), { motivo: 'otro', faltanHoras: null })
igual('un rechazo "otro" termina en la pantalla de error',
  visitaReducir(en('solicitando'), { tipo: 'SOLICITUD_RECHAZADA', motivo: 'otro', mensaje: 'No autorizado' }).paso,
  'error')
// La salida del 401: volver al registro (ABRIR_REGISTRO ya es la transicion que muestra el registro;
// el POST falla con la fase en 'solicitando', asi que esa es la transicion que importa).
igual('ABRIR_REGISTRO sale de "solicitando" (el estado real cuando falla el POST)',
  visitaReducir(en('solicitando'), { tipo: 'ABRIR_REGISTRO' }).paso, 'registrando')
igual('ABRIR_REGISTRO tambien sale de la pantalla de error',
  visitaReducir(en('error', { mensaje: 'No autorizado' }), { tipo: 'ABRIR_REGISTRO' }).paso, 'registrando')


// --- Tarjeta de sellos: la vista que se le pasa a <TarjetaSellos /> -------
console.log('\n== tarjeta ==')
// Fixture con la forma REAL de GET /visitas/mi-tarjeta (verificada contra el backend).
const RESPUESTA = {
  cliente: { id: 'c1', nombre: 'Oscar Gabriel', telefono: '+5493585705745', sellosActuales: 1, puntosActuales: 250,
             totalVisitas: 1, ultimaVisita: '2026-10-06T14:32:02.876Z' },
  sucursal: { id: 's1', nombre: 'Centro', slug: 'centro', esPrincipal: true },
  tarjetas: [], sucursalId: 's1', modoClientes: 'GLOBAL',
  sellosActuales: 1, sellosParaPremio: 10, premioTexto: 'Cafe gratis', premioDesbloqueado: false,
  faltantes: 9, porcentaje: 10, mostrarResena: true, puntosActuales: 250, totalVisitas: 1,
} as unknown as MiTarjetaRespuesta
igual('SOLO_PUNTOS -> solo puntos', tipoDeTarjeta('SOLO_PUNTOS'), { tipo: 'PUNTOS', mostrarSellos: false, mostrarPuntos: true })
igual('SOLO_VISITAS -> solo visitas', tipoDeTarjeta('SOLO_VISITAS'), { tipo: 'VISITAS', mostrarSellos: true, mostrarPuntos: false })
// HIBRIDO ya NO se colapsa: muestra las dos barras (sellos + puntos).
igual('HIBRIDO -> las dos barras', tipoDeTarjeta('HIBRIDO'), { tipo: 'HIBRIDO', mostrarSellos: true, mostrarPuntos: true })
igual('sin modo -> solo visitas', tipoDeTarjeta(undefined), { tipo: 'VISITAS', mostrarSellos: true, mostrarPuntos: false })
const v = vistaDeTarjeta(RESPUESTA, 'SOLO_VISITAS')
igual('toma sellos y meta del backend', [v.actuales, v.meta], [1, 10])
igual('recalcula faltantes y porcentaje', [v.faltantes, v.porcentaje], [9, 10])
igual('muestra el premio del backend', [v.premioTexto, v.premioDesbloqueado], ['Cafe gratis', false])
igual('nombre y sucursal salen de la respuesta', [v.nombreCliente, v.sucursalNombre], ['Oscar Gabriel', 'Centro'])
chk('la ultima visita es Date', v.ultimaVisita instanceof Date)
// Con PUNTOS cambia lo que se cuenta, y el progreso se recalcula (no se copia el del backend).
const vp = vistaDeTarjeta(RESPUESTA, 'SOLO_PUNTOS')
igual('en PUNTOS cuenta puntos', [vp.tipo, vp.actuales], ['PUNTOS', 250])
chk('en PUNTOS el porcentaje es el de puntos', vp.porcentaje === 100)
// Blindaje: si el backend dice que NO hay premio pero los sellos ya alcanzan, el premio gana.
const conPremio = vistaDeTarjeta({ ...RESPUESTA, sellosActuales: 10 } as MiTarjetaRespuesta, 'SOLO_VISITAS')
igual('con los sellos completos el premio se marca solo', [conPremio.premioDesbloqueado, conPremio.faltantes, conPremio.porcentaje], [true, 0, 100])

// --- Confirmacion: QUE sumaste (con HIBRIDO son dos incrementos) -------------
const base = { sellosActuales: 4, premioDesbloqueado: false }
igual(
  'HIBRIDO dice sello + puntos',
  resumenDeAprobacion({ ...base, modoFidelizacion: 'HIBRIDO', sellosOtorgados: 1, puntosOtorgados: 34 }),
  '¡Sumaste +1 sello y +34 puntos!',
)
igual(
  'SOLO_VISITAS dice solo el sello',
  resumenDeAprobacion({ ...base, modoFidelizacion: 'SOLO_VISITAS', sellosOtorgados: 1, puntosOtorgados: 34 }),
  '¡Sumaste +1 sello!',
)
igual(
  'SOLO_PUNTOS dice solo los puntos',
  resumenDeAprobacion({ ...base, modoFidelizacion: 'SOLO_PUNTOS', sellosOtorgados: 1, puntosOtorgados: 34 }),
  '¡Sumaste +34 puntos!',
)
igual('sin incrementos (evento viejo) devuelve null', resumenDeAprobacion(base), null)

// El reducer guarda lo que vino del WS (y no inventa lo que no vino).
const conPuntos = visitaReducir(ESTADO_INICIAL, {
  tipo: 'WS_APROBADA', sellosActuales: 4, premioDesbloqueado: false,
  modoFidelizacion: 'HIBRIDO', sellosOtorgados: 1, puntosOtorgados: 34, puntosActuales: 124,
})
igual(
  'el reducer guarda los incrementos',
  [conPuntos.sellos?.puntosOtorgados, conPuntos.sellos?.puntosActuales, conPuntos.sellos?.modoFidelizacion],
  [34, 124, 'HIBRIDO'],
)
const sinExtras = visitaReducir(ESTADO_INICIAL, { tipo: 'WS_APROBADA', sellosActuales: 4, premioDesbloqueado: false })
igual('un evento sin los campos nuevos no los inventa', [sinExtras.sellos?.puntosOtorgados, sinExtras.sellos?.modoFidelizacion], [undefined, undefined])

// --- Pasamanos COMPLETO: payload del WS -> evento -> estado (un solo tipo) --------
const payloadCompleto: VisitaAprobadaPayload = {
  visitaId: 'v1', sucursalId: 's1', sellosActuales: 4, sellosCliente: 4, sellosTarjetaSucursal: 4,
  premioDesbloqueado: false, sellosOtorgados: 1, puntosOtorgados: 34, puntosActuales: 124,
  modoFidelizacion: 'HIBRIDO', premioPuntosDesbloqueado: false, aprobadoEn: '2026-10-08T00:00:00.000Z',
}
const porElPasamanos = visitaReducir(ESTADO_INICIAL, eventoDeAprobacion(payloadCompleto))
igual(
  'el evento armado desde el payload conserva los campos del estado',
  [porElPasamanos.sellos?.sellosActuales, porElPasamanos.sellos?.puntosOtorgados, porElPasamanos.sellos?.puntosActuales, porElPasamanos.sellos?.modoFidelizacion],
  [4, 34, 124, 'HIBRIDO'],
)
igual(
  'y la confirmacion arma los dos incrementos',
  [resumenDeAprobacion(porElPasamanos.sellos), resumenDeAprobacion(sinExtras.sellos)],
  ['¡Sumaste +1 sello y +34 puntos!', null],
)
// Compat: un payload PARCIAL (backend viejo) no rompe: los opcionales quedan undefined.
const conParcial = visitaReducir(ESTADO_INICIAL, eventoDeAprobacion({ sellosActuales: 7, premioDesbloqueado: true }))
igual(
  'payload parcial: opcionales undefined y sin crash',
  [conParcial.paso, conParcial.sellos?.sellosActuales, conParcial.sellos?.puntosOtorgados, resumenDeAprobacion(conParcial.sellos)],
  ['aprobada', 7, undefined, null],
)
const sinMeta = vistaDeTarjeta({ ...RESPUESTA, sellosParaPremio: 0 } as MiTarjetaRespuesta, 'SOLO_VISITAS')
igual('sin meta cae a 10 (nunca divide por cero)', [sinMeta.meta, sinMeta.porcentaje], [10, 10])

console.log(`\n  TOTAL: ${ok} OK, ${fallas.length} FALLA`)
if (fallas.length) {
  console.log('  FALLARON: ' + fallas.join(' | '))
  process.exit(1)
}
