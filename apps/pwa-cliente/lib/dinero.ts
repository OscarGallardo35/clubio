/** Formateo de plata para es-AR (sin decimales si son .00). */
export function formatearPrecio(valor: number | string | null | undefined): string {
  const n = Number(valor)
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Precio con modificadores: base + suma de extras. */
export function precioConExtras(base: number | string, extras: Array<number | string> = []): number {
  return extras.reduce<number>((acc, e) => acc + (Number(e) || 0), Number(base) || 0)
}
