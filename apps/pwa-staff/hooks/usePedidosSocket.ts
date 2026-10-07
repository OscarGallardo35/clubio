'use client'

import * as React from 'react';
import { EVENTOS_PEDIDO, crearSocketPedidos } from '@/lib/socket';

export interface UsoPedidosSocket {
  enVivo: boolean;
  /** Cambia con CADA evento de pedido: el que lo usa refetchea. */
  cambios: number;
  /** Cambia en cada conexion, incluidas las RECONEXIONES (heartbeat). */
  conexiones: number;
}

/**
 * Socket del staff en el namespace /pedidos.
 *
 * No intenta interpretar el evento (el payload no trae el pedido entero): cualquier
 * `pedido:nuevo` / `pedido:asignado` / `pedido:estado-actualizado` / `pedido:cancelado`
 * dispara `cambios`, y la lista se refetchea. Refetchear es mas simple y mas
 * confiable que mergear payloads parciales, y el endpoint ES la fuente de verdad.
 */
export function usePedidosSocket(): UsoPedidosSocket {
  const [enVivo, setEnVivo] = React.useState(false);
  const [cambios, setCambios] = React.useState(0);
  const [conexiones, setConexiones] = React.useState(0);

  React.useEffect(() => {
    // Sin token: la cookie HttpOnly (empleado_token) viaja en el handshake gracias a
    // withCredentials. El gateway la lee (COOKIE_EMPLEADO) y WsJwtGuard valida el tipo.
    const socket = crearSocketPedidos();
    const marcar = () => setCambios((n) => n + 1);

    socket.on('connect', () => {
      setEnVivo(true);
      setConexiones((n) => n + 1);
    });
    socket.on('disconnect', () => setEnVivo(false));
    socket.on('connect_error', () => setEnVivo(false));

    socket.on(EVENTOS_PEDIDO.nuevo, marcar);
    socket.on(EVENTOS_PEDIDO.asignado, marcar);
    socket.on(EVENTOS_PEDIDO.estado, marcar);
    socket.on(EVENTOS_PEDIDO.cancelado, marcar);

    return () => {
      socket.disconnect();
      setEnVivo(false);
    };
  }, []);

  return { enVivo, cambios, conexiones };
}
