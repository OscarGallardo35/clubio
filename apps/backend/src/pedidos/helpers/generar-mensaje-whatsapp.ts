import type { ItemPedido } from '../interfaces/pedido-item.interface';
import { etiquetaTipo } from './calcular-totales';

const ETIQUETA_PAGO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  TARJETA: 'Tarjeta',
};

const pesos = (n: number) =>
  `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface DatosMensaje {
  nombreCliente: string;
  items: ItemPedido[];
  subtotal: number;
  costoEnvio: number;
  total: number;
  tipo: string;
  mesa?: string | null;
  modoPago: string;
  notas?: string | null;
  urlCorta: string;
}

/**
 * Mensaje pre-armado que el cliente le manda al negocio por WhatsApp.
 * Corto y sin emojis raros: algunos clientes de WhatsApp los rompen.
 */
export function generarMensajeWhatsApp(d: DatosMensaje): string {
  const lineas: string[] = [];
  lineas.push(`Nuevo pedido de ${d.nombreCliente}`);
  lineas.push('');

  for (const it of d.items) {
    const mods = it.modificadores.length
      ? ` [${it.modificadores.map((m) => m.opcionNombre).join(', ')}]`
      : '';
    const nota = it.notas ? ` (${it.notas})` : '';
    lineas.push(`${it.cantidad}x ${it.nombre}${mods}${nota} - ${pesos(it.subtotal)}`);
  }

  lineas.push('');
  lineas.push('-----');
  lineas.push(`Subtotal: ${pesos(d.subtotal)}`);
  if (d.costoEnvio > 0) lineas.push(`Envio: ${pesos(d.costoEnvio)}`);
  lineas.push(`Total: ${pesos(d.total)}`);
  lineas.push(`Tipo: ${etiquetaTipo(d.tipo)}${d.mesa ? ` (Mesa ${d.mesa})` : ''}`);
  lineas.push(`Pago: ${ETIQUETA_PAGO[d.modoPago] ?? d.modoPago}`);
  if (d.notas) lineas.push(`Nota: ${d.notas}`);

  lineas.push('');
  lineas.push(`Ver detalle: ${d.urlCorta}`);

  return lineas.join('\n');
}