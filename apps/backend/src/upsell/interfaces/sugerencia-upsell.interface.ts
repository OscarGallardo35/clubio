/** Item destino enriquecido que viaja en la sugerencia. */
export interface ItemSugerido {
  id: string;
  nombre: string;
  precio: number;
  fotoUrl: string | null;
  categoria: string;
  etiquetas: string[];
  disponible: boolean;
}

export interface SugerenciaUpsell {
  reglaId: string;
  mensaje: string;
  item: ItemSugerido;
  motivo: string;
}