import type { Socket } from 'socket.io-client'
import { createSocket } from '@repo/api-client'
import { WS_URL } from './api'

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
