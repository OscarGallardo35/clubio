/**
 * Maquina de decision del PERFILADO PROGRESIVO (fase 1: cumpleaños y genero).
 *
 * Es una funcion PURA `entrada -> decision`: sin React, sin fetch, sin localStorage y sin
 * timers. El estado que vive afuera (el cliente que devuelve /auth/cliente/me, la config del
 * local y los dos sellos de tiempo de localStorage) entra como parametro, asi que la decision
 * entera se puede probar en node sin browser (ver scripts/check-perfilamiento.mts).
 *
 * Reglas de diseño (todas verificadas en el check):
 *  1. SIN CONFIGURACION NO SE PREGUNTA NADA. Si `perfilDesdeVisita` no viene (undefined/null),
 *     se trata como "todavia no" y no se muestra el cartel. Asi la PWA no se adelanta a un
 *     backend que todavia no expone el campo.
 *  2. UN RECHAZO EXPLICITO MANDA SOBRE TODO. Con `perfiladoRechazado` el cliente ya dijo que no:
 *     no se le vuelve a pedir ningun dato, ni con 50 visitas ni con la config nueva.
 *  3. NO SE PIDE LO QUE YA TIENE. Un dato cargado (incluso `PREFIERO_NO_DECIR`, que es una
 *     respuesta valida) no se vuelve a pedir nunca desde este cartel; se cambia desde Mi perfil.
 *  4. UN DATO POR VEZ, Y EL CUMPLE PRIMERO. Si falta el cumple, se pide el cumple; el genero
 *     solo despues (ver regla 5) y solo cuando el cumple ya esta resuelto.
 *  5. EL GENERO ESPERA AL UMBRAL. No se pide antes de `VISITAS_MINIMAS_PARA_GENERO` visitas
 *     (6) NI antes de `DIAS_MINIMOS_TRAS_CUMPLE_PARA_GENERO` dias (30) desde que el cliente
 *     contesto el cumple (lo que pase primero). Preguntar el genero en la misma sesion en que
 *     contesto el cumple seria un formulario encubierto, y esto es un cartel no invasivo.
 *  6. SI CIERRA EL CARTEL, SILENCIO. Omitir guarda un sello de tiempo por negocio (localStorage)
 *     y arranca un cooldown de `DIAS_COOLDOWN_TRAS_OMITIR` dias. Se toma el mas reciente entre
 *     lo local y lo que informe el backend (`perfiladoOmitidoEn`), asi el cooldown vale tambien
 *     si el cliente entro desde otro dispositivo.
 */
import type { ClienteBasico, Genero } from '@/types/api'

/** Opciones del genero, en el orden en que se muestran. El tipo manda: falta una y no compila. */
export const GENEROS: readonly Genero[] = [
  'FEMENINO',
  'MASCULINO',
  'NO_BINARIO',
  'OTRO',
  'PREFIERO_NO_DECIR',
]

/** Etiquetas de cara al cliente (el `Record<Genero, ...>` obliga a cubrir las cinco). */
export const ETIQUETA_GENERO: Record<Genero, string> = {
  FEMENINO: 'Mujer',
  MASCULINO: 'Hombre',
  NO_BINARIO: 'No binario',
  OTRO: 'Otro',
  PREFIERO_NO_DECIR: 'Prefiero no decir',
}

/** Que dato se pide. Uno por vez. */
export type DatoPerfil = 'cumple' | 'genero'

/** Default del backend: a partir de la 3ra visita. */
export const PERFIL_DESDE_VISITA_DEFECTO = 3

/** Visitas para pedir el genero aunque el cumple se haya contestado hace poco. */
export const VISITAS_MINIMAS_PARA_GENERO = 6

/** Dias desde que contesto el cumple para pedir el genero sin llegar a las 6 visitas. */
export const DIAS_MINIMOS_TRAS_CUMPLE_PARA_GENERO = 30

/** Cuanto se espera antes de volver a mostrar el cartel si el cliente lo cerro. */
export const DIAS_COOLDOWN_TRAS_OMITIR = 30

/** Tope de edad razonable para la fecha de nacimiento (el `min` del input). */
export const DIAS_MAXIMOS_DE_EDAD = 100

const DIA_MS = 24 * 60 * 60 * 1000

/** Por que NO se muestra (y cual se esta mostrando). Util para testear y depurar. */
export type MotivoPerfil =
  | 'rechazado'
  | 'sin-configuracion'
  | 'completo'
  | 'pocas-visitas'
  | 'cooldown'
  | 'esperando-umbral-genero'
  | 'preguntando'

export interface DecisionPerfil {
  /** true = hay que mostrar el cartel. */
  mostrar: boolean
  /** Que se pide cuando `mostrar` es true (null si no hay nada que pedir). */
  dato: DatoPerfil | null
  motivo: MotivoPerfil
}

/**
 * Todo lo que la decision necesita saber. Los campos del cliente y de la config son OPCIONALES a
 * proposito: mientras el backend no los exponga llegan `undefined` y la decision tiene que
 * degradar sola (regla 1), no romper.
 */
export interface EntradaPerfilamiento {
  /** `totalVisitas` del cliente (ya lo devuelve /auth/cliente/me). */
  totalVisitas?: number | null | undefined
  /** `perfilDesdeVisita` de la config publica del local (default del backend: 3). */
  perfilDesdeVisita?: number | null | undefined
  /** ISO (o 'YYYY-MM-DD') guardado; null/undefined = no lo tiene. */
  fechaNacimiento?: string | null | undefined
  /** Valor guardado; null/undefined = no lo tiene. */
  genero?: Genero | null | undefined
  /** true = el cliente pidio que no le pregunten mas. */
  perfiladoRechazado?: boolean | null | undefined
  /** ISO en que cerro el cartel en ESTE dispositivo (localStorage por negocio). */
  dismissEnLocalStorage?: string | null | undefined
  /** ISO que informa el backend (`perfiladoOmitidoEn`). */
  ultimaOmitidoEn?: string | null | undefined
  /**
   * ISO en que el cliente guardo el cumpleaños en ESTE dispositivo. Es lo unico que permite medir
   * los 30 dias de la regla 5: `fechaNacimiento` es la fecha de nacimiento, no cuando la cargo.
   */
  cumpleRespondidoEn?: string | null | undefined
  /** "Ahora", para poder testear sin depender del reloj. */
  ahora?: string | number | Date | undefined
}

/** Fecha en ms, o null si no es una fecha usable. */
function aMs(valor: string | number | Date | null | undefined): number | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (valor instanceof Date) {
    const t = valor.getTime()
    return Number.isFinite(t) ? t : null
  }
  const t = new Date(valor).getTime()
  return Number.isFinite(t) ? t : null
}

/** true si hay una fecha de nacimiento usable (no vacia, parseable). */
export function tieneCumple(fechaNacimiento: string | null | undefined): boolean {
  return aMs(fechaNacimiento) !== null
}

/** true si hay un genero valido guardado. `PREFIERO_NO_DECIR` cuenta como respuesta. */
export function tieneGenero(genero: string | null | undefined): boolean {
  return typeof genero === 'string' && (GENEROS as readonly string[]).includes(genero)
}

function sinMostrar(motivo: MotivoPerfil): DecisionPerfil {
  return { mostrar: false, dato: null, motivo }
}

/**
 * El dato mas reciente entre lo guardado local y lo que informa el backend.
 * Se usa el maximo y no uno solo: si el cliente cerro el cartel en el telefono y despues lo
 * cerro en otro dispositivo, el cooldown tiene que correr desde el ultimo cierre.
 */
function ultimaOmision(e: EntradaPerfilamiento): number | null {
  const local = aMs(e.dismissEnLocalStorage)
  const servidor = aMs(e.ultimaOmitidoEn)
  if (local === null) return servidor
  if (servidor === null) return local
  return Math.max(local, servidor)
}

/**
 * true si ya pasaron las 6 visitas O los 30 dias desde que contesto el cumple
 * (lo que ocurra primero). Con `cumpleRespondidoEn` ausente solo queda el contador de visitas:
 * no se inventa una fecha.
 */
export function umbralGeneroAlcanzado(
  e: EntradaPerfilamiento,
  ahora: number = Date.now(),
): boolean {
  const visitas = typeof e.totalVisitas === 'number' && Number.isFinite(e.totalVisitas) ? e.totalVisitas : 0
  if (visitas >= VISITAS_MINIMAS_PARA_GENERO) return true
  const contestoEn = aMs(e.cumpleRespondidoEn)
  if (contestoEn === null) return false
  return ahora - contestoEn >= DIAS_MINIMOS_TRAS_CUMPLE_PARA_GENERO * DIA_MS
}

/**
 * La decision. Ver las reglas 1-6 del encabezado: el orden de los chequeos ES la especificacion.
 */
export function decidirPerfilamiento(e: EntradaPerfilamiento): DecisionPerfil {
  const ahora = aMs(e.ahora ?? null) ?? Date.now()

  // Regla 2: un rechazo explicito es definitivo, gane quien gane la config.
  if (e.perfiladoRechazado === true) return sinMostrar('rechazado')

  // Regla 1: sin configuracion no se pregunta (backend viejo o campo no deployado).
  const desde = e.perfilDesdeVisita
  if (typeof desde !== 'number' || !Number.isFinite(desde) || desde < 1) {
    return sinMostrar('sin-configuracion')
  }

  const faltaCumple = !tieneCumple(e.fechaNacimiento)
  const faltaGenero = !tieneGenero(e.genero)

  // Regla 3: ya tiene los dos datos.
  if (!faltaCumple && !faltaGenero) return sinMostrar('completo')

  const visitas = typeof e.totalVisitas === 'number' && Number.isFinite(e.totalVisitas) ? e.totalVisitas : 0
  // Regla: 3ra visita o mas (configurable por el dueño del local).
  if (visitas < desde) return sinMostrar('pocas-visitas')

  // Regla 6: cooldown por omision.
  const omitido = ultimaOmision(e)
  if (omitido !== null && ahora - omitido < DIAS_COOLDOWN_TRAS_OMITIR * DIA_MS) {
    return sinMostrar('cooldown')
  }

  // Regla 4: primero el cumple.
  if (faltaCumple) return { mostrar: true, dato: 'cumple', motivo: 'preguntando' }

  // Regla 5: y el genero recien cuando toca.
  if (!umbralGeneroAlcanzado(e, ahora)) return sinMostrar('esperando-umbral-genero')

  return { mostrar: true, dato: 'genero', motivo: 'preguntando' }
}

/**
 * Textos del cartel, en UN solo lugar: el componente los recibe y el check los asserta
 * (mismo criterio que `textoDelMotivo` en visita-maquina).
 *
 * OJO: no se promete ningun premio. El dueño configura los premios aparte y prometer uno aca
 * seria una promesa que el local no hizo.
 */
export function textosDePerfil(
  dato: DatoPerfil,
  nombreNegocio: string,
): { titulo: string; ayuda: string; consentimiento: string; cta: string; ahoraNo: string } {
  if (dato === 'cumple') {
    return {
      titulo: '¿Nos contás tu cumpleaños?',
      ayuda: 'Lo usamos solo para saludarte ese día. Es opcional.',
      consentimiento: `Guardar mi cumpleaños y que ${nombreNegocio} me salude ese día`,
      cta: 'Guardar',
      ahoraNo: 'Ahora no',
    }
  }
  return {
    titulo: '¿Cómo te identificás?',
    ayuda: 'Nos ayuda a mandarte solo las promos que te interesan. No lo compartimos con nadie.',
    consentimiento: `Guardar cómo me identifico y que ${nombreNegocio} lo use para sus promos`,
    cta: 'Guardar',
    ahoraNo: 'Ahora no',
  }
}

// --- Fecha de nacimiento: limites y validacion (puro, testeable) ------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 'YYYY-MM-DD' de la fecha local del dispositivo. */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * `min`/`max` del <input type="date">: hoy es el maximo (no se puede haber nacido mañana) y
 * hoy - 100 años el minimo (evita el 1900 por dedazo, que es el error de tipeo mas comun).
 */
export function limitesDeFechaNacimiento(ahora: number | Date = Date.now()): { min: string; max: string } {
  const d = ahora instanceof Date ? ahora : new Date(ahora)
  const min = new Date(d.getFullYear() - DIAS_MAXIMOS_DE_EDAD, d.getMonth(), d.getDate())
  return { min: ymdLocal(min), max: ymdLocal(d) }
}

export type ResultadoFecha = { ok: true; valor: string } | { ok: false; error: string }

/**
 * Valida la fecha ANTES de mandarla al backend: formato, fecha real (2026-02-31 no existe),
 * no futura y no mas de 100 años atras. Devuelve el valor normalizado para el PATCH.
 */
export function validarFechaNacimiento(
  valor: string | null | undefined,
  ahora: number | Date = Date.now(),
): ResultadoFecha {
  const v = (valor ?? '').trim()
  if (!v) return { ok: false, error: 'Elegí tu fecha de nacimiento.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'Esa fecha no es válida.' }

  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const fecha = new Date(Date.UTC(y, m - 1, d))
  // Round-trip: si el dia no existe (31 de febrero), Date lo corre y no coincide.
  if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) {
    return { ok: false, error: 'Esa fecha no es válida.' }
  }

  const { min, max } = limitesDeFechaNacimiento(ahora)
  // Comparacion lexicografica: 'YYYY-MM-DD' ordena igual que la fecha.
  if (v > max) return { ok: false, error: 'Esa fecha todavía no pasó.' }
  if (v < min) return { ok: false, error: `Revisá el año: no puede ser hace más de ${DIAS_MAXIMOS_DE_EDAD} años.` }

  return { ok: true, valor: v }
}

/**
 * '3 de mayo' para mostrar (sin año: es un dato de festejo, no de identidad).
 *
 * Se formatea en UTC a proposito: es una fecha de calendario, no un instante. En Argentina
 * (UTC-3) formatear '1990-05-03T00:00:00Z' en hora local daria "2 de mayo": un dia menos, el
 * bug clasico de las fechas de nacimiento.
 */
export function cumpleLegible(fechaNacimiento: string | null | undefined): string | null {
  const ms = aMs(fechaNacimiento)
  if (ms === null) return null
  const fmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  return fmt.format(new Date(ms))
}

// --- Respuesta del PATCH ---------------------------------------------------------------------

/**
 * El contrato del PATCH es "devuelve el cliente actualizado", sin decir si viene envuelto en un
 * `ClienteMe` o pelado. Esta funcion acepta las dos formas y devuelve null si no reconoce
 * ninguna: el llamador decide que hacer (no se inventa un cliente).
 *
 * El objeto se devuelve TAL CUAL lo mando el backend: trae los campos de perfil (fechaNacimiento,
 * genero, perfiladoRechazado) que el store mergea. Se exige `id` + `nombre` porque son los
 * obligatorios de `ClienteBasico`: sin ellos el merge dejaria un cliente a medias.
 */
export function clienteDeRespuestaPerfil(respuesta: unknown): ClienteBasico | null {
  if (!respuesta || typeof respuesta !== 'object') return null
  const conEnvoltura = respuesta as { cliente?: unknown }
  const candidato =
    conEnvoltura.cliente && typeof conEnvoltura.cliente === 'object'
      ? (conEnvoltura.cliente as { id?: unknown; nombre?: unknown })
      : (respuesta as { id?: unknown; nombre?: unknown })

  if (typeof candidato.id === 'string' && typeof candidato.nombre === 'string') {
    return candidato as ClienteBasico
  }
  return null
}
