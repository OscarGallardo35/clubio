'use client'

import * as React from 'react';
import { EVENTOS_VISITA, crearSocketStaff } from '@/lib/socket';
import { useEmpleadoStore } from '@/stores/empleadoStore';
import type { VisitaSolicitadaWs } from '@/types/api';

export interface UsoVisitasSocket {
  /** true si el socket esta conectado (para el indicador y el polling de respaldo). */
  enVivo: boolean;
  /** Ultima solicitud recibida por WS (para prepend en la lista). */
  ultimaSolicitada: VisitaSolicitadaWs | null;
}

/**
 * Escucha `visita:solicitada` de la sala del empleado.
 *
 * Si el WS se cae, `enVivo` pasa a false: el que lo use se encarga del respaldo
 * (refetch), que es la razon de exponerlo.
 */
export function useVisitasSocket(): UsoVisitasSocket {
  const token = useEmpleadoStore((st) => st.token);
  const [enVivo, setEnVivo] = React.useState(false);
  const [ultimaSolicitada, setUltima] = React.useState<VisitaSolicitadaWs | null>(null);

  React.useEffect(() => {
    if (!token) return undefined;
    const socket = crearSocketStaff(token);

    socket.on('connect', () => setEnVivo(true));
    socket.on('disconnect', () => setEnVivo(false));
    socket.on('connect_error', () => setEnVivo(false));
    socket.on(EVENTOS_VISITA.solicitada, (p: VisitaSolicitadaWs) => setUltima(p));

    return () => {
      socket.disconnect();
      setEnVivo(false);
    };
  }, [token]);

  return { enVivo, ultimaSolicitada };
}
