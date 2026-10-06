/**
 * Helpers de imagen, PUROS: sin React, sin lucide, sin nada de UI.
 *
 * Viven en `lib/` y no en el componente para poder importarlos desde un script de node
 * (`check:menu`) sin arrastrar React. Regla general del repo: si una funcion es pura, va en
 * `lib/` y el componente la consume.
 */

export type TipoImagenOptimizada = 'item' | 'avatar' | 'logo' | 'categoria'

/** Ancho con el que se le pide la imagen a Cloudinary segun el uso. */
export const ANCHO_POR_TIPO: Record<TipoImagenOptimizada, number> = {
  item: 600,
  categoria: 320,
  logo: 240,
  avatar: 128,
}

/** Proporcion por defecto de cada tipo, para reservar el espacio (evita CLS). */
export const RATIO_POR_TIPO: Record<TipoImagenOptimizada, number> = {
  item: 4 / 3,
  categoria: 4 / 3,
  logo: 1,
  avatar: 1,
}

/**
 * Aplica las transformaciones basicas si la imagen es de Cloudinary.
 *
 * Solo cuando la URL NO trae ya una transformacion: si lo que sigue a `/upload/` empieza con
 * `v<digitos>/`, se asume que ya viene transformada y se deja igual. Asi no se pisan los
 * recortes que haya definido el negocio.
 */
export function urlOptimizada(src: string, tipo: TipoImagenOptimizada): string {
  const limpia = src.trim()
  if (!/res\.cloudinary\.com\//.test(limpia)) return limpia
  const partes = limpia.split('/upload/')
  const base = partes[0]
  const resto = partes[1]
  // Sin los chequeos de undefined, `noUncheckedIndexedAccess` no deja pasar `partes[1]` a test().
  if (partes.length !== 2 || base === undefined || resto === undefined) return limpia
  if (!/^v\d+\//.test(resto)) return limpia
  return `${base}/upload/c_fill,w_${ANCHO_POR_TIPO[tipo]},q_auto:good,f_auto/${resto}`
}
