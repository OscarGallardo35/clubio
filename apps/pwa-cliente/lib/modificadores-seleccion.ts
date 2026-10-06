/**
 * Seleccion de modificadores: piezas PURAS para poder assertarlas desde node.
 *
 * El modal es presentacional y guarda la seleccion como `Record<grupoId, opcionIds[]>`
 * (SIEMPRE array, incluso en UNICA_SELECCION: es lo que espera el backend). Aca vive la
 * traduccion a las formas que usan el validador y el carrito, mas la interaccion de radio vs
 * checkbox, que es la unica logica del modal que vale la pena probar.
 */

import type { GrupoModificadorPublico } from './modificadores-cache'
import type { ItemCarrito, ModificadorElegido } from './carrito-maquina'

/** opcionIds por grupo. Array tambien en UNICA_SELECCION (lo exige la API). */
export type SeleccionPorGrupo = Record<string, string[]>

export const MAX_NOTAS = 200

export function seleccionVacia(): SeleccionPorGrupo {
  return {}
}

/** Recorta las notas al maximo del backend y de la UI. */
export function recortarNotas(notas: string): string {
  return notas.slice(0, MAX_NOTAS)
}

/**
 * La interaccion de elegir una opcion.
 *
 * - UNICA_SELECCION: reemplaza (elegir otra desmarca la anterior; volver a tocar la elegida
 *   la desmarca, para poder arrepentirse).
 * - MULTIPLE_SELECCION: alterna, y NO pasa del maximo (si se llego al tope, el toque no hace
 *   nada en vez de romper la validacion).
 *
 * No borra la clave cuando queda vacia: una clave con array vacio y una ausente son lo mismo
 * para el validador, y mantenerla hace el estado mas predecible.
 */
export function alternarSeleccion(
  grupos: GrupoModificadorPublico[],
  seleccion: SeleccionPorGrupo,
  grupoId: string,
  opcionId: string,
): SeleccionPorGrupo {
  const grupo = grupos.find((g) => g.id === grupoId)
  if (!grupo) return seleccion
  const actuales = seleccion[grupoId] ?? []

  if (grupo.tipo === 'UNICA_SELECCION') {
    const yaEstaba = actuales.includes(opcionId)
    return { ...seleccion, [grupoId]: yaEstaba ? [] : [opcionId] }
  }

  if (actuales.includes(opcionId)) {
    return { ...seleccion, [grupoId]: actuales.filter((id) => id !== opcionId) }
  }
  const tope = grupo.maxSelecciones ?? Infinity
  if (actuales.length >= tope) return seleccion // al tope: el toque no hace nada
  return { ...seleccion, [grupoId]: [...actuales, opcionId] }
}

/**
 * Traduce la seleccion a la forma que espera `validarModificadores`: solo los grupos con algo
 * elegido, con las opciones resueltas (nombre y precio) para que el validador y el carrito no
 * tengan que volver a buscar en los grupos.
 */
export function elegidosDesde(
  grupos: GrupoModificadorPublico[],
  seleccion: SeleccionPorGrupo,
): ModificadorElegido[] {
  return grupos
    .map((g) => {
      const ids = seleccion[g.id] ?? []
      const opciones = g.opciones
        .filter((o) => ids.includes(o.id))
        .map((o) => ({ id: o.id, nombre: o.nombre, precioExtra: o.precioExtra }))
      return { grupoId: g.id, grupoNombre: g.nombre, opciones }
    })
    .filter((m) => m.opciones.length > 0)
}

/**
 * El item tal como lo consume el carrito (y `precioUnitario`, que es la unica formula de
 * precio). OJO: la forma que viaja a la API es `{grupoId, opcionIds}` y se arma en el borde de
 * la API, no aca.
 */
export function armarItemProvisional(
  item: { id: string; nombre: string; precio: number; fotoUrl?: string | null | undefined },
  seleccion: SeleccionPorGrupo,
  notas: string,
  grupos: GrupoModificadorPublico[] = [],
): ItemCarrito {
  const modificadores = elegidosDesde(grupos, seleccion)
  return {
    // La clave y la cantidad no importan para el precio; se completan aca para que el objeto
    // sea un ItemCarrito valido y `precioUnitario` pueda usarse tal cual.
    clave: `${item.id}#preview`,
    itemId: item.id,
    nombre: item.nombre,
    precioBase: item.precio,
    ...(item.fotoUrl ? { imagenUrl: item.fotoUrl } : {}),
    cantidad: 1,
    notas: recortarNotas(notas),
    modificadores,
  }
}

/** Los grupos obligatorios que todavia no tienen nada elegido (para el copy del boton). */
export function gruposObligatoriosFaltantes(
  grupos: GrupoModificadorPublico[],
  seleccion: SeleccionPorGrupo,
): string[] {
  return grupos
    .filter((g) => g.obligatorio && (seleccion[g.id]?.length ?? 0) < Math.max(1, g.minSelecciones))
    .map((g) => g.nombre)
}

/**
 * La forma que espera la API al crear el pedido: `{ grupoId, opcionIds }`.
 *
 * El carrito guarda la forma CON nombre y precio (la necesita para mostrar y para calcular), asi
 * que la conversion se hace recien en el borde de la API. No muta la entrada.
 */
export function modificadoresParaApi(
  modificadores: ModificadorElegido[],
): { grupoId: string; opcionIds: string[] }[] {
  return modificadores
    .map((m) => ({ grupoId: m.grupoId, opcionIds: m.opciones.map((o) => o.id) }))
    .filter((m) => m.opcionIds.length > 0)
}

