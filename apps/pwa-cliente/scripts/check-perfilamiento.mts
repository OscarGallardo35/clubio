/**
 * Check de la maquina de PERFILADO PROGRESIVO (fase 1: cumpleaños y genero).
 *
 * Corre en node pelado (sin Vitest, sin jsdom, sin browser):
 *
 *   pnpm --filter @mi-saas/pwa-cliente check:perfilamiento
 *
 * Cubre las reglas del encabezado de lib/perfilamiento-maquina.ts: umbral de visitas, un dato por
 * vez (cumple primero), no pedir lo que ya tiene, rechazo definitivo, cooldown de la omision,
 * umbral del genero y validacion de la fecha. Ademas chequea que las opciones de genero y los
 * textos del cartel sean los que el negocio aprobo (no se promete ningun premio).
 */
import {
  DIAS_COOLDOWN_TRAS_OMITIR,
  DIAS_MAXIMOS_DE_EDAD,
  DIAS_MINIMOS_TRAS_CUMPLE_PARA_GENERO,
  ETIQUETA_GENERO,
  GENEROS,
  PERFIL_DESDE_VISITA_DEFECTO,
  VISITAS_MINIMAS_PARA_GENERO,
  clienteDeRespuestaPerfil,
  cumpleLegible,
  decidirPerfilamiento,
  limitesDeFechaNacimiento,
  textosDePerfil,
  umbralGeneroAlcanzado,
  validarFechaNacimiento,
} from '../lib/perfilamiento-maquina.ts'
import type { EntradaPerfilamiento } from '../lib/perfilamiento-maquina.ts'

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
  chk(
    nombre,
    JSON.stringify(real) === JSON.stringify(esperado),
    `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`,
  )
}

/** Un instante fijo para no depender del reloj: 15/10/2026 12:00 UTC. */
const AHORA = Date.parse('2026-10-15T12:00:00.000Z')
const DIA_MS = 24 * 60 * 60 * 1000
const isoHaceDias = (dias: number) => new Date(AHORA - dias * DIA_MS).toISOString()

/** Caso base: cliente de 3 visitas, sin datos, con la config default del backend. */
function entrada(extra: Partial<EntradaPerfilamiento> = {}): EntradaPerfilamiento {
  return {
    totalVisitas: 3,
    perfilDesdeVisita: PERFIL_DESDE_VISITA_DEFECTO,
    fechaNacimiento: null,
    genero: null,
    perfiladoRechazado: false,
    dismissEnLocalStorage: null,
    ultimaOmitidoEn: null,
    cumpleRespondidoEn: null,
    ahora: AHORA,
    ...extra,
  }
}

console.log('=== 1. constantes del negocio ===')
igual('el local pregunta desde la 3ra visita (default del backend)', PERFIL_DESDE_VISITA_DEFECTO, 3)
igual('el genero espera a las 6 visitas', VISITAS_MINIMAS_PARA_GENERO, 6)
igual('y a los 30 dias de haber contestado el cumple', DIAS_MINIMOS_TRAS_CUMPLE_PARA_GENERO, 30)
igual('cooldown de la omision: 30 dias', DIAS_COOLDOWN_TRAS_OMITIR, 30)
igual('el input de fecha llega a 100 años atras', DIAS_MAXIMOS_DE_EDAD, 100)
igual('las 5 opciones de genero, en orden', GENEROS, ['FEMENINO', 'MASCULINO', 'NO_BINARIO', 'OTRO', 'PREFIERO_NO_DECIR'])
igual('las etiquetas de cara al cliente', GENEROS.map((g) => ETIQUETA_GENERO[g]), [
  'Mujer',
  'Hombre',
  'No binario',
  'Otro',
  'Prefiero no decir',
])

console.log('\n=== 2. la 1ra y la 2da visita NO preguntan ===')
igual('1ra visita: nada', decidirPerfilamiento(entrada({ totalVisitas: 1 })), {
  mostrar: false,
  dato: null,
  motivo: 'pocas-visitas',
})
igual('2da visita: nada', decidirPerfilamiento(entrada({ totalVisitas: 2 })), {
  mostrar: false,
  dato: null,
  motivo: 'pocas-visitas',
})
igual('cliente sin totalVisitas (undefined): nada', decidirPerfilamiento(entrada({ totalVisitas: undefined })), {
  mostrar: false,
  dato: null,
  motivo: 'pocas-visitas',
})

console.log('\n=== 3. la 3ra visita pide el CUMPLEAÑOS (y primero el cumple, no el genero) ===')
igual('3ra visita: pide cumple', decidirPerfilamiento(entrada()), {
  mostrar: true,
  dato: 'cumple',
  motivo: 'preguntando',
})
igual('10ma visita sin nada: igual pide cumple primero', decidirPerfilamiento(entrada({ totalVisitas: 10 })).dato, 'cumple')

console.log('\n=== 4. configurable por el dueño ===')
igual('con perfilDesdeVisita = 5, en la 3ra no pregunta', decidirPerfilamiento(entrada({ perfilDesdeVisita: 5 })).motivo, 'pocas-visitas')
igual('con perfilDesdeVisita = 5, en la 5ta si', decidirPerfilamiento(entrada({ perfilDesdeVisita: 5, totalVisitas: 5 })).dato, 'cumple')
igual('con perfilDesdeVisita = 1, en la 1ra ya pregunta', decidirPerfilamiento(entrada({ perfilDesdeVisita: 1, totalVisitas: 1 })).dato, 'cumple')

console.log('\n=== 5. SIN perfilDesdeVisita (undefined / basura) NO se pregunta ===')
igual('undefined: no pregunta todavia', decidirPerfilamiento(entrada({ perfilDesdeVisita: undefined })), {
  mostrar: false,
  dato: null,
  motivo: 'sin-configuracion',
})
igual('null: no pregunta', decidirPerfilamiento(entrada({ perfilDesdeVisita: null })).motivo, 'sin-configuracion')
igual('0: no pregunta (no es un umbral valido)', decidirPerfilamiento(entrada({ perfilDesdeVisita: 0 })).motivo, 'sin-configuracion')
igual('NaN: no pregunta', decidirPerfilamiento(entrada({ perfilDesdeVisita: Number.NaN })).motivo, 'sin-configuracion')
chk('sin config NUNCA mostrar=true', [undefined, null, 0, Number.NaN, -3].every((v) => !decidirPerfilamiento(entrada({ perfilDesdeVisita: v as never })).mostrar))

console.log('\n=== 6. no se pide lo que ya tiene ===')
igual('con los dos datos: nada', decidirPerfilamiento(entrada({ fechaNacimiento: '1990-05-03', genero: 'FEMENINO' })), {
  mostrar: false,
  dato: null,
  motivo: 'completo',
})
igual('con cumple pero sin genero: NO pide el cumple de nuevo', decidirPerfilamiento(entrada({ fechaNacimiento: '1990-05-03' })).dato, null)
igual('PREFIERO_NO_DECIR es una respuesta valida (no se vuelve a pedir)', decidirPerfilamiento(entrada({ fechaNacimiento: '1990-05-03', genero: 'PREFIERO_NO_DECIR' })).motivo, 'completo')
igual('un genero con valor invalido se trata como sin cargar', decidirPerfilamiento(entrada({ fechaNacimiento: '1990-05-03', totalVisitas: 9, genero: 'OTROX' as never })).dato, 'genero')
igual('una fechaNacimiento vacia cuenta como sin cargar', decidirPerfilamiento(entrada({ fechaNacimiento: '' })).dato, 'cumple')

console.log('\n=== 7. un RECHAZO explicito no pregunta NUNCA mas ===')
igual('rechazado + 50 visitas + todo faltante: nada', decidirPerfilamiento(entrada({ totalVisitas: 50, perfiladoRechazado: true })), {
  mostrar: false,
  dato: null,
  motivo: 'rechazado',
})
igual('el rechazo le gana a la falta de configuracion', decidirPerfilamiento(entrada({ perfiladoRechazado: true, perfilDesdeVisita: undefined })).motivo, 'rechazado')
igual('el rechazo le gana al umbral del genero alcanzado', decidirPerfilamiento(entrada({ totalVisitas: 40, fechaNacimiento: '1990-05-03', perfiladoRechazado: true })).mostrar, false)
igual('rechazado=false no bloquea si corresponde preguntar', decidirPerfilamiento(entrada({ perfiladoRechazado: false })).dato, 'cumple')

console.log('\n=== 8. cooldown del cierre del cartel (dismiss) ===')
igual('cerro hoy: no se muestra', decidirPerfilamiento(entrada({ dismissEnLocalStorage: isoHaceDias(0) })), {
  mostrar: false,
  dato: null,
  motivo: 'cooldown',
})
igual('cerro hace 29 dias: sigue en cooldown', decidirPerfilamiento(entrada({ dismissEnLocalStorage: isoHaceDias(29) })).motivo, 'cooldown')
igual('cerro hace 30 dias justo: ya se puede mostrar', decidirPerfilamiento(entrada({ dismissEnLocalStorage: isoHaceDias(30) })).dato, 'cumple')
igual('cerro hace 60 dias: se muestra', decidirPerfilamiento(entrada({ dismissEnLocalStorage: isoHaceDias(60) })).mostrar, true)
igual('el omitidoEn del SERVIDOR tambien cuenta (otro dispositivo)', decidirPerfilamiento(entrada({ ultimaOmitidoEn: isoHaceDias(2) })).motivo, 'cooldown')
igual('se toma el mas RECIENTE de los dos', decidirPerfilamiento(entrada({ dismissEnLocalStorage: isoHaceDias(90), ultimaOmitidoEn: isoHaceDias(5) })).motivo, 'cooldown')
igual('una fecha ilegible no inventa cooldown', decidirPerfilamiento(entrada({ dismissEnLocalStorage: 'no-es-fecha' })).dato, 'cumple')

console.log('\n=== 9. el GENERO espera al umbral ===')
// El cumple ya esta cargado y contestado hace 0 dias, con 3 visitas: todavia no.
const cumpleHoy = { fechaNacimiento: '1990-05-03', genero: null, cumpleRespondidoEn: isoHaceDias(0) }
igual('3 visitas y cumple contestado hoy: no pide genero', decidirPerfilamiento(entrada(cumpleHoy)), {
  mostrar: false,
  dato: null,
  motivo: 'esperando-umbral-genero',
})
igual(`4 visitas: sigue esperando (el umbral son ${VISITAS_MINIMAS_PARA_GENERO})`, decidirPerfilamiento(entrada({ ...cumpleHoy, totalVisitas: 4 })).mostrar, false)
igual('6 visitas: ya pide genero', decidirPerfilamiento(entrada({ ...cumpleHoy, totalVisitas: 6 })), {
  mostrar: true,
  dato: 'genero',
  motivo: 'preguntando',
})
igual('5 visitas pero 30 dias desde el cumple: pide genero', decidirPerfilamiento(entrada({ ...cumpleHoy, totalVisitas: 5, cumpleRespondidoEn: isoHaceDias(30) })).dato, 'genero')
igual('5 visitas y 29 dias: todavia no', decidirPerfilamiento(entrada({ ...cumpleHoy, totalVisitas: 5, cumpleRespondidoEn: isoHaceDias(29) })).mostrar, false)
igual('sin saber cuando contesto el cumple, manda el contador de visitas', decidirPerfilamiento(entrada({ fechaNacimiento: '1990-05-03', totalVisitas: 3, cumpleRespondidoEn: null })), {
  mostrar: false,
  dato: null,
  motivo: 'esperando-umbral-genero',
})
igual('el genero tambien respeta el cooldown', decidirPerfilamiento(entrada({ ...cumpleHoy, totalVisitas: 8, dismissEnLocalStorage: isoHaceDias(1) })).motivo, 'cooldown')
chk('umbralGeneroAlcanzado: 6 visitas', umbralGeneroAlcanzado({ totalVisitas: 6 }, AHORA))
chk('umbralGeneroAlcanzado: 30 dias', umbralGeneroAlcanzado({ totalVisitas: 0, cumpleRespondidoEn: isoHaceDias(30) }, AHORA))
chk('umbralGeneroAlcanzado: ni una ni otra', !umbralGeneroAlcanzado({ totalVisitas: 5, cumpleRespondidoEn: isoHaceDias(29) }, AHORA))

console.log('\n=== 10. la fecha de nacimiento se valida ANTES de mandarla ===')
igual('una fecha normal pasa', validarFechaNacimiento('1990-05-03', AHORA), { ok: true, valor: '1990-05-03' })
chk('FECHA FUTURA rechazada', !validarFechaNacimiento('2027-01-01', AHORA).ok)
igual('el error de la fecha futura lo explica', validarFechaNacimiento('2027-01-01', AHORA), {
  ok: false,
  error: 'Esa fecha todavía no pasó.',
})
chk('Hoy SI se puede (nacio hoy, caso de dedazo pero valido)', validarFechaNacimiento('2026-10-15', AHORA).ok)
chk('mañana no', !validarFechaNacimiento('2026-10-16', AHORA).ok)
igual('vacia: pide la fecha', validarFechaNacimiento('', AHORA), { ok: false, error: 'Elegí tu fecha de nacimiento.' })
igual('undefined: pide la fecha', validarFechaNacimiento(undefined, AHORA).ok, false)
igual('formato raro: invalida', validarFechaNacimiento('03/05/1990', AHORA).ok, false)
igual('un dia que no existe (31 de febrero): invalida', validarFechaNacimiento('1990-02-31', AHORA).ok, false)
igual('mes 13: invalida', validarFechaNacimiento('1990-13-01', AHORA).ok, false)
chk('hace 99 años pasa', validarFechaNacimiento('1927-10-15', AHORA).ok)
chk('hace 101 años no (revisar el año)', !validarFechaNacimiento('1925-10-14', AHORA).ok)
const limites = limitesDeFechaNacimiento(AHORA)
igual('max del input = hoy', limites.max, '2026-10-15')
igual('min del input = hoy - 100 años', limites.min, '1926-10-15')

console.log('\n=== 11. textos del cartel (los aprobados, sin prometer premios) ===')
const cumple = textosDePerfil('cumple', 'Bar La Esquina')
igual('titulo del cumple', cumple.titulo, '¿Nos contás tu cumpleaños?')
igual('ayuda del cumple', cumple.ayuda, 'Lo usamos solo para saludarte ese día. Es opcional.')
igual('consentimiento del cumple (nombra al local)', cumple.consentimiento, 'Guardar mi cumpleaños y que Bar La Esquina me salude ese día')
igual('botones del cumple', [cumple.cta, cumple.ahoraNo], ['Guardar', 'Ahora no'])
const genero = textosDePerfil('genero', 'Bar La Esquina')
igual('titulo del genero', genero.titulo, '¿Cómo te identificás?')
igual('ayuda del genero', genero.ayuda, 'Nos ayuda a mandarte solo las promos que te interesan. No lo compartimos con nadie.')
igual('consentimiento del genero', genero.consentimiento, 'Guardar cómo me identifico y que Bar La Esquina lo use para sus promos')
chk(
  'NINGUN texto del cartel promete un premio',
  [cumple, genero].every((t) => !/premio|gratis|regalo|descuento|sello/i.test(`${t.titulo} ${t.ayuda} ${t.consentimiento} ${t.cta}`)),
)
chk('el genero no se pide en la misma sesion que el cumple (por diseño)', textosDePerfil('genero', 'X').titulo !== cumple.titulo)

console.log('\n=== 12. respuesta del PATCH ===')
igual('envuelta en ClienteMe', clienteDeRespuestaPerfil({ cliente: { id: 'c1', nombre: 'Ana', fechaNacimiento: '1990-05-03' } }), {
  id: 'c1',
  nombre: 'Ana',
  fechaNacimiento: '1990-05-03',
})
igual('pelada', clienteDeRespuestaPerfil({ id: 'c1', nombre: 'Ana' }), { id: 'c1', nombre: 'Ana' })
igual('basura: null (no se inventa un cliente)', clienteDeRespuestaPerfil({ algo: 1 }), null)
igual('null: null', clienteDeRespuestaPerfil(null), null)
igual('undefined: null', clienteDeRespuestaPerfil(undefined), null)

console.log('\n=== 13. el cumple se muestra como fecha de calendario (sin corrimiento) ===')
igual('3 de mayo (UTC, no 2 en Argentina)', cumpleLegible('1990-05-03T00:00:00.000Z'), '3 de mayo')
igual('31 de diciembre no se corre al año anterior', cumpleLegible('1990-12-31'), '31 de diciembre')
igual('sin fecha: null', cumpleLegible(null), null)

console.log(`\n  ${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
for (const f of fallas) console.log(`   FALLA ${f}`)
process.exit(fallas.length === 0 ? 0 : 1)
