import type { Socket } from 'socket.io-client'
import { createSocket } from '@repo/api-client'
import type { Transporte } from '@repo/api-client'
import { WS_URL } from './api'

/**
 * Transportes del cliente: WebSocket PRIMERO (que es lo que emite al instante) y polling
 * como respaldo si el WS no se puede establecer.
 *
 * `['websocket']` a secas (la config historica) deja al cliente SIN socket cuando la red no
 * permite el upgrade — proxy, wifi corporativo, algunos operadores — y ahi la tarjeta y el
 * flujo de visita se quedan solo con el polling. Con el respaldo, esa red recupera los
 * avisos en vivo; en una red normal el comportamiento es identico (el WS abre igual).
 */
export const TRANSPORTES_WS: Transporte[] = ['websocket', 'polling']

/**
 * Socket del namespace /visitas.
 *
 * El token va en `auth.token` (es lo que lee el gateway del backend). La PWA
 * Cliente lo tiene en memoria porque la cookie es HttpOnly y JS no puede leerla;
 * si no hay token, el handshake igual se autentica con la cookie.
 */
// El tipo de retorno va EXPLICITO: con pnpm, TS no puede nombrar el tipo inferido
// sin referenciar una ruta interna de .pnpm (TS2742, no portable).
export function crearSocketVisitas(token?: string | null, namespace = '/visitas'): Socket {
  return createSocket({
    url: WS_URL,
    token: token ?? null,
    namespace,
    transports: TRANSPORTES_WS,
  })
}

/**
 * Socket del namespace /pedidos.
 *
 * OJO con el invitado: el gateway de pedidos exige token en el handshake (`validarToken`) y corta
 * el socket si no hay identidad, asi que este socket SOLO sirve para clientes logueados. El que
 * escanea el QR sin cuenta no tiene WS: para el, el polling es el unico mecanismo, no un respaldo.
 *
 * `pedidoId` es opcional: si el cliente esta logueado ya esta en su sala `cliente:{id}` y recibe
 * los cambios igual. Mandarlo agrega la sala `pedido:{id}`.
 */
export function crearSocketPedidos(token?: string | null, pedidoId?: string | null): Socket {
  return createSocket({
    url: WS_URL,
    token: token ?? null,
    namespace: '/pedidos',
    ...(pedidoId ? { auth: { pedidoId } } : {}),
  })
}
