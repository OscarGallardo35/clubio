import { formatearPrecio as formatearPrecioCompartido } from '@repo/utils'

/**
 * Reexporta el formateador de @repo/utils en vez de tener una segunda
 * implementacion: si el dia de manana se agrega una moneda o cambia el redondeo,
 * se cambia en un solo lugar. Aca solo queda lo propio del carrito.
 */
export function formatearPrecio(valor: number | string | null | undefined): string {
  const n = Number(valor)
  if (!Number.isFinite(n)) return ''
  return formatearPrecioCompartido(n)
}

/** Precio con modificadores: base + suma de extras. */
export function precioConExtras(base: number | string, extras: Array<number | string> = []): number {
  return extras.reduce<number>((acc, e) => acc + (Number(e) || 0), Number(base) || 0)
}
