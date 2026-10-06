/**
 * Acceso a localStorage seguro para SSR.
 * Todo lo que se guarda es dato del cliente que el backend puede revalidar; nada
 * de tokens (el JWT del cliente vive en una cookie HttpOnly) ni de datos de pago.
 */

export function leerJson<T>(clave: string, porDefecto: T): T {
  if (typeof window === 'undefined') return porDefecto
  try {
    const crudo = window.localStorage.getItem(clave)
    if (!crudo) return porDefecto
    return JSON.parse(crudo) as T
  } catch {
    return porDefecto
  }
}

export function escribirJson(clave: string, valor: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // cuota llena o modo privado: no es fatal
  }
}

export function borrar(clave: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(clave)
  } catch {
    // ignorado a proposito
  }
}

/** Clave con namespace por negocio: lo de un negocio no pisa lo de otro. */
export function clavePorNegocio(clave: string, negocioSlug: string): string {
  return `${clave}:${negocioSlug}`
}
