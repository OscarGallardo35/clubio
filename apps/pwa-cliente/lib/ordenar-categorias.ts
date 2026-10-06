/**
 * Orden de las categorias de la carta.
 *
 * Verificado contra GET /carta real (con header X-Tenant-Slug): el backend manda las categorias
 * en orden ALFABETICO y el objeto es solo `{ categoria, items }`, sin campo `orden`:
 *
 *   Bebidas, Entradas, Postres, Principales
 *
 * O sea que "Principales" queda ultima, que es justo lo contrario de lo que se espera ver en el
 * celular. El criterio se resuelve aca, en el cliente.
 *
 * Si algun dia el backend agrega un `orden` numerico (hoy no existe), se respeta primero y esta
 * funcion no se toca.
 */

export interface CategoriaOrdenable {
  categoria: string
  orden?: number | null | undefined
  items?: readonly unknown[] | undefined
}

/** La categoria que va primera si tiene items (match exacto, sin distinguir mayusculas). */
export const CATEGORIA_PRIMERA = 'principales'

export function ordenarCategorias<T extends CategoriaOrdenable>(categorias: readonly T[]): T[] {
  const copia = [...categorias]
  if (copia.length <= 1) return copia

  // El backend hoy no manda `orden`; si lo manda (y esta en todas), manda el backend.
  const conOrden = copia.filter((c) => typeof c.orden === 'number')
  if (conOrden.length === copia.length) {
    return copia.sort((a, b) => (a.orden as number) - (b.orden as number))
  }

  const alfabetico = (a: T, b: T) => a.categoria.localeCompare(b.categoria, 'es', { sensitivity: 'base' })
  const tieneItems = (c: T) => (c.items?.length ?? 0) > 0
  const esPrincipales = (c: T) => c.categoria.trim().toLowerCase() === CATEGORIA_PRIMERA

  // "Principales" primero SOLO si tiene items: una categoria vacia no gana el primer lugar.
  const primera = copia.filter((c) => esPrincipales(c) && tieneItems(c))
  const resto = copia.filter((c) => !(esPrincipales(c) && tieneItems(c)))
  return [...primera.sort(alfabetico), ...resto.sort(alfabetico)]
}
