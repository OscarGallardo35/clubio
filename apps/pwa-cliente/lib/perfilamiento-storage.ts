/**
 * Lo que el perfilado progresivo guarda en el DISPOSITIVO (nunca datos personales).
 *
 * Solo dos sellos de tiempo, por negocio (`cliente:perfilamiento:<slug>`), siguiendo el patron de
 * lib/storage.ts (leerJson/escribirJson/clavePorNegocio) que ya usan el carrito y la sucursal:
 *
 *  - `omitidoEn`: cuando el cliente cerro el cartel. Arranca el cooldown (ver la maquina).
 *  - `cumpleRespondidoEn`: cuando guardo el cumpleaños. Es lo unico que permite medir los 30 dias
 *    antes de pedir el genero (el backend guarda la FECHA de nacimiento, no cuando la cargo).
 *
 * La fecha de nacimiento y el genero NO se guardan aca: son datos declarados y viven en el
 * backend, que es el que puede borrarlos de verdad (derecho de supresion, Ley 25.326).
 * Todo el modulo es seguro en SSR: las funciones de storage.ts ya chequean `window`.
 */
import { clavePorNegocio, borrar, leerJson, escribirJson } from './storage'
import { STORAGE } from './constants'

/** Clave base (una sola fuente: lib/constants.ts); se namespacea por negocio. */
export const CLAVE_PERFILAMIENTO = STORAGE.perfilamiento

export interface PerfilamientoLocal {
  /** ISO en que el cliente cerro el cartel (swipe, tap afuera o "Ahora no"). */
  omitidoEn?: string | null
  /** ISO en que guardo el cumpleaños desde este dispositivo. */
  cumpleRespondidoEn?: string | null
}

export function leerPerfilamientoLocal(negocioSlug: string | null | undefined): PerfilamientoLocal {
  if (!negocioSlug) return {}
  const crudo = leerJson<PerfilamientoLocal>(clavePorNegocio(CLAVE_PERFILAMIENTO, negocioSlug), {})
  return crudo && typeof crudo === 'object' ? crudo : {}
}

export function guardarPerfilamientoLocal(
  negocioSlug: string | null | undefined,
  estado: PerfilamientoLocal,
): void {
  if (!negocioSlug) return
  escribirJson(clavePorNegocio(CLAVE_PERFILAMIENTO, negocioSlug), estado)
}

/** El cliente cerro el cartel: arranca (o reinicia) el cooldown. */
export function marcarOmitido(
  negocioSlug: string | null | undefined,
  ahora: number | Date = Date.now(),
): PerfilamientoLocal {
  const estado = { ...leerPerfilamientoLocal(negocioSlug), omitidoEn: new Date(ahora).toISOString() }
  guardarPerfilamientoLocal(negocioSlug, estado)
  return estado
}

/** El cliente guardo el cumple: se anota cuando, para el umbral del genero. */
export function marcarCumpleRespondido(
  negocioSlug: string | null | undefined,
  ahora: number | Date = Date.now(),
): PerfilamientoLocal {
  const estado = {
    ...leerPerfilamientoLocal(negocioSlug),
    cumpleRespondidoEn: new Date(ahora).toISOString(),
  }
  guardarPerfilamientoLocal(negocioSlug, estado)
  return estado
}

/**
 * Borra lo local del negocio. Es parte del borrado de datos del cliente (Mi perfil): si el
 * cliente pide que le borren lo que declaró, el rastro en el telefono tambien se va.
 */
export function limpiarPerfilamientoLocal(negocioSlug: string | null | undefined): void {
  if (!negocioSlug) return
  borrar(clavePorNegocio(CLAVE_PERFILAMIENTO, negocioSlug))
}
