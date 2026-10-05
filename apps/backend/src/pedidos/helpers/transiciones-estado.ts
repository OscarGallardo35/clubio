import { EstadoPedido } from '@prisma/client';

/**
 * Maquina de estados del pedido. Cualquier transicion que no figure aca es 400.
 * La rama LISTO -> ENVIADO | ENTREGADO depende del tipo (DELIVERY vs resto).
 */
export const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  PENDIENTE: [EstadoPedido.CONFIRMADO, EstadoPedido.RECHAZADO],
  CONFIRMADO: [EstadoPedido.EN_PREPARACION, EstadoPedido.CANCELADO],
  EN_PREPARACION: [EstadoPedido.LISTO, EstadoPedido.CANCELADO],
  LISTO: [EstadoPedido.ENTREGADO, EstadoPedido.ENVIADO],
  ENVIADO: [EstadoPedido.ENTREGADO],
  ENTREGADO: [],
  CANCELADO: [],
  RECHAZADO: [],
};

export const ESTADOS_ACTIVOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE,
  EstadoPedido.CONFIRMADO,
  EstadoPedido.EN_PREPARACION,
  EstadoPedido.LISTO,
  EstadoPedido.ENVIADO,
];

export function transicionValida(desde: EstadoPedido, hacia: EstadoPedido): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

/** LISTO -> ENVIADO solo tiene sentido en DELIVERY; el resto pasa a ENTREGADO. */
export function transicionValidaParaTipo(
  desde: EstadoPedido, hacia: EstadoPedido, tipo: string,
): boolean {
  if (!transicionValida(desde, hacia)) return false;
  if (desde === EstadoPedido.LISTO && hacia === EstadoPedido.ENVIADO && tipo !== 'DELIVERY') {
    return false;
  }
  return true;
}

export const TITULO_POR_ESTADO: Partial<Record<EstadoPedido, string>> = {
  CONFIRMADO: 'Pedido confirmado',
  EN_PREPARACION: 'Tu pedido se esta preparando',
  LISTO: 'Tu pedido esta listo',
  ENVIADO: 'Tu pedido salio en camino',
  ENTREGADO: 'Pedido entregado',
  CANCELADO: 'Pedido cancelado',
  RECHAZADO: 'Pedido rechazado',
};

export const MENSAJE_POR_ESTADO: Partial<Record<EstadoPedido, string>> = {
  CONFIRMADO: 'El local confirmo tu pedido.',
  EN_PREPARACION: 'Estamos preparando tu pedido.',
  LISTO: 'Ya podes retirarlo.',
  ENVIADO: 'El delivery esta en camino.',
  ENTREGADO: 'Gracias por tu compra.',
  CANCELADO: 'El pedido fue cancelado.',
  RECHAZADO: 'El local no pudo tomar el pedido.',
};
