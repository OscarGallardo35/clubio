
/**
 * Estructura de cada item DENTRO del JSON Pedido.items.
 *
 * precioBase  = precio de carta del item (con el override de la sucursal si lo hay)
 * precioFinal = precioBase + suma de precioExtra de las opciones elegidas
 */
export interface ModificadorElegido {
  grupoId: string;
  grupoNombre: string;
  opcionId: string;
  opcionNombre: string;
  /** Recargo unitario de la opcion (0 si no tiene). */
  precioExtra: number;
}

export interface ItemPedido {
  itemId: string;
  nombre: string;
  precioBase: number;
  precioFinal: number;
  cantidad: number;
  notas?: string;
  /** Un registro por OPCION elegida (vacio si el item no tiene modificadores). */
  modificadores: ModificadorElegido[];
  /** precioFinal * cantidad, ya calculado. */
  subtotal: number;
}

/** Modificador que manda el cliente: `opcionIds` es SIEMPRE array (aunque el grupo sea UNICA_SELECCION). */
export interface ModificadorInput {
  grupoId: string;
  opcionIds: string[];
}

/** Entrada cruda que manda el cliente. */
export interface ItemInput {
  itemId: string;
  cantidad: number;
  notas?: string;
  /** Aceptado pero IGNORADO: el precio siempre se recalcula desde la DB. */
  precio?: number;
  modificadores?: ModificadorInput[];
}

export interface PedidoCtx {
  empleadoId: string;
  rol: string;
  sucursalId?: string | null;
  ip?: string;
}
