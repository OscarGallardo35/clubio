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
