'use client'

import * as React from 'react';
import { EVENTOS_VISITA, crearSocketStaff } from '@/lib/socket';
import type { VisitaSolicitadaWs } from '@/types/api';

export interface UsoVisitasSocket {
  /** true si el socket esta conectado (para el indicador y el polling de respaldo). */
  enVivo: boolean;
  /** Ultima solicitud recibida por WS (para prepend en la lista). */
  ultimaSolicitada: VisitaSolicitadaWs | null;
  /**
   * Cuenta las conexiones del socket (incluye las RECONEXIONES).
   *
   * El que lo usa refetchea cuando cambia: el WS adelanta, el endpoint es la
   * fuente de verdad, y al reconectar hay que recuperar lo que paso mientras
   * estabamos desconectados.
   */
  conexiones: number;
}

/**
 * Escucha `visita:solicitada` de la sala del empleado.
 *
 * Si el WS se cae, `enVivo` pasa a false: el que lo use se encarga del respaldo
 * (refetch), que es la razon de exponerlo.
 */
export function useVisitasSocket(): UsoVisitasSocket {
  const [enVivo, setEnVivo] = React.useState(false);
  const [ultimaSolicitada, setUltima] = React.useState<VisitaSolicitadaWs | null>(null);
  const [conexiones, setConexiones] = React.useState(0);

  React.useEffect(() => {
    // Sin token: la cookie HttpOnly (empleado_token) viaja en el handshake.
    const socket = crearSocketStaff();

    socket.on('connect', () => {
      setEnVivo(true);
      setConexiones((n) => n + 1);
    });
    socket.on('disconnect', () => setEnVivo(false));
    socket.on('connect_error', () => setEnVivo(false));
    socket.on(EVENTOS_VISITA.solicitada, (p: VisitaSolicitadaWs) => setUltima(p));

    return () => {
      socket.disconnect();
      setEnVivo(false);
    };
  }, []);

  return { enVivo, ultimaSolicitada, conexiones };
}
