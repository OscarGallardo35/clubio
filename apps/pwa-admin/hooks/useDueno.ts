'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { duenoApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { useDuenoStore } from '@/stores/duenoStore';
import type { DuenoSesion } from '@/types/api';

export interface UsoDueno {
  dueno: DuenoSesion['dueno'] | null;
  negocio: DuenoSesion['negocio'] | null;
  autenticado: boolean;
  cargando: boolean;
  /** true una vez que se sabe si hay sesion o no (evita el flash de login). */
  resuelto: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Sesion del dueno.
 *
 * Distincion que importa (la misma que en la staff):
 * - 401 => no hay sesion (o vencio): se limpia y se va a /login.
 * - Cualquier otro error (red, 500) => NO se cierra la sesion. Un backend caido no puede
 *   eyectar al dueno que esta administrando su local.
 *
 * El sondeo de sesion es `GET /auth/dueno/me` (Fase 0c): devuelve la identidad del dueno y su
 * negocio, y sale por `JwtDuenoGuard`, que acepta la cookie `dueno_token` ademas del Bearer.
 */
export function useDueno(): UsoDueno {
  const { dueno, negocio, autenticado, cargando } = useDuenoStore();
  const fijarSesion = useDuenoStore((s) => s.fijarSesion);
  const limpiar = useDuenoStore((s) => s.limpiar);
  const router = useRouter();
  const [resuelto, setResuelto] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const sesion = await duenoApi.me();
      fijarSesion(sesion);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status === 401) {
        limpiar();
        // Se vuelve al destino ACTUAL (con query) para no perder a donde iba.
        // window y no useSearchParams: este hook vive en el layout y useSearchParams obligaria a
        // un <Suspense> para poder prerenderizar.
        const actual =
          typeof window === 'undefined'
            ? '/login'
            : `/login?volver=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        router.replace(actual);
      } else {
        setError(mensaje);
      }
    } finally {
      setResuelto(true);
    }
  }, [fijarSesion, limpiar, router]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  const logout = React.useCallback(async () => {
    try {
      await duenoApi.logout();
    } catch {
      // Si el logout falla en el servidor, igual se limpia local: cuando la cookie exista
      // (Fase 0c) la borra el backend; si no, vence sola.
    }
    limpiar();
    router.replace('/login');
  }, [limpiar, router]);

  return { dueno, negocio, autenticado, cargando, resuelto, error, refetch, logout };
}
