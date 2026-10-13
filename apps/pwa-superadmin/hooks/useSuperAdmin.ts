'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { superadminApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { useSuperAdminStore } from '@/stores/superadminStore';
import { RUTA_INICIO, RUTA_LOGIN } from '@/lib/constants';
import type { SuperAdminSesion } from '@/types/api';

export interface UsoSuperAdmin {
  superadmin: SuperAdminSesion['superadmin'] | null;
  autenticado: boolean;
  cargando: boolean;
  /** true una vez que se sabe si hay sesion o no (evita el flash de login). */
  resuelto: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

/** Login del panel con el destino actual (para no perder la query en curso). */
function loginActual(): string {
  if (typeof window === 'undefined') return RUTA_LOGIN;
  const destino = encodeURIComponent(window.location.pathname + window.location.search);
  return `${RUTA_LOGIN}?volver=${destino}`;
}

/**
 * Sesion del operador de la plataforma.
 *
 * Distincion que importa (la misma que en las otras PWAs):
 * - 401 => no hay sesion (o vencio): se limpia y se va al login.
 * - Cualquier otro error (red, 500) => NO se cierra la sesion. Un backend caido no
 *   puede eyectar al operador que esta armando demos.
 *
 * El sondeo es `GET /api/superadmin/auth/me`, que sale por `SuperAdminGuard` (cookie
 * `superadmin_token` host-only o Bearer con el secreto de plataforma).
 */
export function useSuperAdmin(): UsoSuperAdmin {
  const { superadmin, autenticado, cargando } = useSuperAdminStore();
  const fijarSesion = useSuperAdminStore((s) => s.fijarSesion);
  const limpiar = useSuperAdminStore((s) => s.limpiar);
  const router = useRouter();
  const [resuelto, setResuelto] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const sesion = await superadminApi.me();
      fijarSesion(sesion);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status === 401) {
        limpiar();
        router.replace(loginActual());
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
      await superadminApi.logout();
    } catch {
      // Si el logout falla en el servidor igual se limpia local: la cookie la borra el
      // backend cuando puede, y si no, vence sola.
    }
    limpiar();
    router.replace(RUTA_LOGIN);
  }, [limpiar, router]);

  return { superadmin, autenticado, cargando, resuelto, error, refetch, logout };
}

/** Se exporta para que las pantallas puedan navegar al inicio sin repetir la constante. */
export const RUTA_INICIAL_PANEL = RUTA_INICIO;
