import { createSocket } from '@repo/api-client';
import { WS_URL } from '@/lib/api';

/**
 * Socket de la PWA Staff (namespace /visitas).
 *
 * El handshake se autentica con la cookie HttpOnly (`empleado_token`), que viaja
 * gracias a `withCredentials`. El gateway resuelve el token en este orden:
 * auth.token -> ?token= -> Authorization -> COOKIE_EMPLEADO -> COOKIE_CLIENTE, y
 * `WsJwtGuard` valida el claim `tipo`, asi que un token de cliente nunca entra por
 * el canal del staff.
 *
 * NOTA HISTORICA: este comentario decia antes que el gateway NO leia la cookie del
 * staff y que hacia falta el token en memoria. Eso quedo viejo cuando se agrego
 * COOKIE_EMPLEADO a los gateways. Con el token en memoria el socket no se creaba
 * cuando el store estaba vacio (post migracion a cookie): las listas andaban por
 * REST y el cartel de conexion mentia.
 *
 * El servidor mete al socket en las salas que corresponden (su sucursal, o todas
 * si tiene accesoMultiSucursal, y la de duenos si el rol es DUENO): no hay que
 * unirse a mano.
 */
export function crearSocketStaff() {
  // createSocket ya usa withCredentials: true: la cookie viaja sola.
  return createSocket({ url: `${WS_URL}/visitas` });
}

export const EVENTOS_VISITA = {
  solicitada: 'visita:solicitada',
  conectado: 'conectado',
} as const;

/** Socket del namespace /pedidos (salas de sucursal + duenos). */
export function crearSocketPedidos() {
  // createSocket ya usa withCredentials: true (transports: websocket).
  return createSocket({ url: `${WS_URL}/pedidos` });
}

export const EVENTOS_PEDIDO = {
  nuevo: 'pedido:nuevo',
  asignado: 'pedido:asignado',
  estado: 'pedido:estado-actualizado',
  cancelado: 'pedido:cancelado',
} as const;
