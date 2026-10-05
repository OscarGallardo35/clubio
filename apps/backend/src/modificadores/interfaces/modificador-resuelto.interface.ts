import { TipoModificador } from '@prisma/client';

/** Grupo con sus opciones, tal como se devuelve al cliente. */
export interface OpcionResuelta {
  id: string;
  nombre: string;
  precioExtra: number;
  disponible: boolean;
  orden: number;
}

export interface GrupoResuelto {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoModificador;
  obligatorio: boolean;
  minSelecciones: number;
  maxSelecciones: number | null;
  orden: number;
  opciones: OpcionResuelta[];
}

/**
 * Modificador VALIDADO de un item del pedido: es lo que queda guardado en el
 * JSON Pedido.items[].modificadores. Un registro por OPCION elegida.
 */
export interface ModificadorElegido {
  grupoId: string;
  grupoNombre: string;
  opcionId: string;
  opcionNombre: string;
  precioExtra: number;
}

/** Grupo + opciones que un item tiene asignados (para validar un pedido). */
export interface GrupoDeItem {
  id: string;
  nombre: string;
  tipo: TipoModificador;
  obligatorio: boolean;
  minSelecciones: number;
  maxSelecciones: number | null;
  opciones: Array<{ id: string; nombre: string; precioExtra: number; disponible: boolean }>;
}