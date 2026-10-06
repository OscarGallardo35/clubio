'use client'

import * as React from 'react';
import { pedidosApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type { PedidoStaff } from '@/types/api';

export type EstadoPedidoDetalle = 'cargando' | 'ok' | 'no-encontrado' | 'error';

export interface UsoPedido {
  pedido: PedidoStaff | null;
  estado: EstadoPedidoDetalle;
  error: string | null;
  refetch: () => Promise<void>;
  /** true mientras una accion (cambiar estado / tomar) esta en vuelo. */
  actualizando: boolean;
  ejecutar: (fn: () => Promise<unknown>) => Promise<boolean>;
}

/**
 * Detalle de un pedido.
 *
 * 404 se trata como estado propio ("no existe" o "es de otro negocio"), no como
 * fallo: el backend devuelve 404 en los dos casos y la pantalla tiene que decir
 * algo distinto que "reintentar".
 */
export function usePedido(id: string): UsoPedido {
  const [pedido, setPedido] = React.useState<PedidoStaff | null>(null);
  const [estado, setEstado] = React.useState<EstadoPedidoDetalle>('cargando');
  const [error, setError] = React.useState<string | null>(null);
  const [actualizando, setActualizando] = React.useState(false);

  const refetch = React.useCallback(async () => {
    try {
      const p = await pedidosApi.obtener(id);
      setPedido(p);
      setEstado('ok');
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      setError(mensaje);
      setEstado(status === 404 ? 'no-encontrado' : 'error');
    }
  }, [id]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  /** Corre una accion y refetchea solo si salio bien. */
  const ejecutar = React.useCallback(
    async (fn: () => Promise<unknown>) => {
      setActualizando(true);
      try {
        await fn();
        await refetch();
        return true;
      } catch (e) {
        const { status, mensaje } = normalizarError(e);
        setError(status >= 500 ? 'No se pudo actualizar el pedido' : mensaje);
        return false;
      } finally {
        setActualizando(false);
      }
    },
    [refetch],
  );

  return { pedido, estado, error, refetch, actualizando, ejecutar };
}
