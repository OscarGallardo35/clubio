/**
 * Estructura de cada item DENTRO del JSON Pedido.items.
 *
 * Preparada para modificadores desde ahora (refinamiento 5): el #2.7 va a
 * validar y poblar `modificadores`, pero el frontend y las estadisticas ya
 * pueden contar con la forma final y no hay que migrar el JSON despues.
 *
 * precioBase  = precio de carta del item
 * precioFinal = precioBase + suma de modificadores (hoy === precioBase)
 */
export interface ModificadorElegido {
  grupoId: string;
  grupoNombre: string;
  opcionId: string;
  opcionNombre: string;
  /** Recargo unitario de la opcion (0 si no tiene). */
  precio: number;
}

export interface ItemPedido {
  itemId: string;
  nombre: string;
  precioBase: number;
  precioFinal: number;
  cantidad: number;
  notas?: string;
  /** Vacio en #2.6; lo completa y valida el #2.7. */
  modificadores: ModificadorElegido[];
  /**
   * (precioFinal + suma de modificadores) * cantidad.
   * Se guarda ya calculado para que las estadisticas no tengan que reinterpretar.
   */
  subtotal: number;
}

/** Entrada cruda que manda el cliente. */
export interface ItemInput {
  itemId: string;
  cantidad: number;
  notas?: string;
  /** Aceptado pero IGNORADO en #2.6: el precio siempre se recalcula desde la DB. */
  precio?: number;
  modificadores?: Array<{ grupoId: string; opcionId: string }>;
}

export interface PedidoCtx {
  empleadoId: string;
  rol: string;
  sucursalId?: string | null;
  ip?: string;
}