/**
 * Maquina de estados PURA del motor de upsell (refinamiento 3 del QR #1).
 *
 * Sin React, sin fetch: entra (estado, evento), sale estado, igual que `carrito-maquina.ts`
 * y `carta-cache.ts`. El reloj entra por parametro (nada de timers), asi que el debounce de
 * 500 ms se prueba sin esperar.
 *
 * La division es la misma que en el cache de la carta: la POLITICA vive en el estado, y
 * `decidirConsulta` es la traduccion a un PLAN ("pedir", "no pedir", "usar cache").
 */

import type { ItemCarrito, SugerenciaUpsell } from './carrito-maquina'

export const DEBOUNCE_UPSELL_MS = 500
/** Tope de entradas en memoria: el upsell es un extra, no puede crecer sin control. */
export const MAX_ENTRADAS_CACHE = 10
/** Motivo con el que el backend avisa que el negocio no tiene upsell activo. */
export const MOTIVO_DESACTIVADO = 'upsell desactivado'

// ---------------------------------------------------------------------------
// Hash del carrito
// ---------------------------------------------------------------------------

/**
 * Forma canonica del carrito: items ordenados, modificadores ordenados y cantidad incluida.
 * `notas` se normaliza (trim) para que un espacio de mas no invente un carrito nuevo.
 */
export function canonicoCarrito(items: ItemCarrito[]): string {
  return items
    .map((i) => {
      const mods = i.modificadores
        .map((m) => `${m.grupoId}:${m.opciones.map((o) => o.id).sort().join(',')}`)
        .sort()
        .join(';')
      return `${i.itemId}#${mods}#${i.notas.trim()}#${i.cantidad}`
    })
    .sort()
    .join('|')
}

/**
 * Hash determinista (FNV-1a 32 bits) de la forma canonica.
 *
 * Es el invariante de todo lo demas: el mismo carrito tiene que dar siempre el mismo hash,
 * sin importar en que orden se agregaron los items ni en que orden vino cada grupo de
 * modificadores. Si esto falla, el cache deja de servir y el debounce se dispara de mas.
 */
export function hashCarrito(items: ItemCarrito[]): string {
  const c = canonicoCarrito(items)
  let h = 2166136261
  for (let i = 0; i < c.length; i++) {
    h ^= c.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${(h >>> 0).toString(36)}-${c.length}`
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export interface EntradaUpsell {
  sugerencias: SugerenciaUpsell[]
  guardadoEn: number
}

export interface EstadoUpsell {
  /** Ultimo hash visto del carrito; es el que espera el debounce. */
  hashPendiente: string | null
  /** Cuando cambio el hash (para medir los 500 ms). */
  hashDesde: number | null
  /** Ultimo hash que efectivamente se consulto (o se resolvio por cache). */
  hashConsultado: string | null
  /** cache: hash -> sugerencias del backend. */
  cache: Record<string, EntradaUpsell>
  /** Reglas ya aceptadas en esta sesion: no se vuelven a ofrecer. */
  aceptadas: string[]
  /** El backend dijo que el negocio no tiene upsell: no se pide nunca mas. */
  desactivado: boolean
  /** Se esta esperando respuesta del backend. */
  cargando: boolean
  /** Motivo que mando el backend en la ultima respuesta. */
  motivo: string | null
}

export type EventoUpsell =
  | { tipo: 'CARRITO_CAMBIO'; items: ItemCarrito[]; ahora: number }
  | { tipo: 'RESPUESTA'; hash: string; sugerencias: SugerenciaUpsell[]; motivo?: string | null; ahora: number }
  | { tipo: 'ERROR' }
  | { tipo: 'ACEPTAR'; reglaId: string }
  | { tipo: 'CAMBIAR_SUCURSAL' }
  | { tipo: 'REINICIAR' }

export function estadoUpsellInicial(): EstadoUpsell {
  return {
    hashPendiente: null,
    hashDesde: null,
    hashConsultado: null,
    cache: {},
    aceptadas: [],
    desactivado: false,
    cargando: false,
    motivo: null,
  }
}

// ---------------------------------------------------------------------------
// Politica -> plan
// ---------------------------------------------------------------------------

export type PlanUpsell =
  | { accion: 'nada'; motivo: 'desactivado' | 'sin-cambios' | 'esperando' | 'ya-consultado' }
  | { accion: 'cache'; hash: string }
  | { accion: 'pedir'; hash: string }

/**
 * Traduce el estado a un plan. Es el UNICO lugar donde se decide si se le pega al backend:
 * el orden de los chequeos importa (lo aprendimos con `planDeFetch`), asi que van de lo mas
 * restrictivo a lo mas permisivo.
 */
export function decidirConsulta(estado: EstadoUpsell, ahora: number): PlanUpsell {
  // 1) el negocio no tiene upsell: ni una request mas en esta sesion.
  if (estado.desactivado) return { accion: 'nada', motivo: 'desactivado' }
  // 2) no hay cambio de carrito pendiente.
  if (!estado.hashPendiente) return { accion: 'nada', motivo: 'sin-cambios' }
  // 3) hay respuesta cacheada: no se pide de nuevo. Va ANTES de "ya consultado" porque da la
  //    etiqueta correcta (si el cache se podo por el tope, cae al 4 y tampoco pide).
  if (estado.cache[estado.hashPendiente]) return { accion: 'cache', hash: estado.hashPendiente }
  // 4) ese hash ya se resolvio y ya no esta en cache.
  if (estado.hashPendiente === estado.hashConsultado) return { accion: 'nada', motivo: 'ya-consultado' }
  // 5) todavia no pasaron los 500 ms desde el ultimo cambio.
  if (estado.hashDesde !== null && ahora - estado.hashDesde < DEBOUNCE_UPSELL_MS) {
    return { accion: 'nada', motivo: 'esperando' }
  }
  return { accion: 'pedir', hash: estado.hashPendiente }
}

/** Lo que se muestra: lo de la ultima consulta, menos lo ya aceptado. */
export function sugerenciasVisibles(estado: EstadoUpsell): SugerenciaUpsell[] {
  const base = estado.hashConsultado ? estado.cache[estado.hashConsultado]?.sugerencias ?? [] : []
  return base.filter((s) => !estado.aceptadas.includes(s.reglaId))
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Guarda una entrada y aplica el tope, sacando la mas vieja. */
function guardarEnCache(
  cache: Record<string, EntradaUpsell>,
  hash: string,
  sugerencias: SugerenciaUpsell[],
  ahora: number,
): Record<string, EntradaUpsell> {
  const siguiente: Record<string, EntradaUpsell> = { ...cache, [hash]: { sugerencias, guardadoEn: ahora } }
  const claves = Object.keys(siguiente)
  if (claves.length > MAX_ENTRADAS_CACHE) {
    const masVieja = claves.reduce((a, b) => ((siguiente[a]?.guardadoEn ?? 0) <= (siguiente[b]?.guardadoEn ?? 0) ? a : b))
    delete siguiente[masVieja]
  }
  return siguiente
}

export function reducerUpsell(estado: EstadoUpsell, evento: EventoUpsell): EstadoUpsell {
  switch (evento.tipo) {
    case 'CARRITO_CAMBIO': {
      const hash = hashCarrito(evento.items)
      // El mismo hash no reinicia nada: si no cambio el carrito, no hay debounce que correr.
      if (hash === estado.hashPendiente) return estado
      return { ...estado, hashPendiente: hash, hashDesde: evento.ahora }
    }

    case 'RESPUESTA': {
      const desactivado = evento.motivo === MOTIVO_DESACTIVADO
      return {
        ...estado,
        cache: guardarEnCache(estado.cache, evento.hash, evento.sugerencias, evento.ahora),
        hashConsultado: evento.hash,
        cargando: false,
        motivo: evento.motivo ?? null,
        desactivado: estado.desactivado || desactivado,
      }
    }

    case 'ERROR':
      // Sin respuesta no se cachea nada y se deja de esperar; el proximo cambio vuelve a probar.
      return { ...estado, cargando: false }

    case 'ACEPTAR': {
      if (estado.aceptadas.includes(evento.reglaId)) return estado
      return { ...estado, aceptadas: [...estado.aceptadas, evento.reglaId] }
    }

    case 'CAMBIAR_SUCURSAL': {
      // Las sugerencias traen precios y disponibilidad de la sucursal: lo cacheado y lo
      // aceptado dejan de valer (los overrides por sucursal pueden cambiarlo todo).
      return {
        ...estadoUpsellInicial(),
        desactivado: estado.desactivado, // si el negocio no tiene upsell, sigue sin tenerlo
        hashPendiente: null,
      }
    }

    case 'REINICIAR':
      return estadoUpsellInicial()

    default:
      return estado
  }
}
