'use client'

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { staffApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import { useEmpleadoStore } from '@/stores/empleadoStore';
import type { EmpleadoMe, EmpleadoStaff, NegocioStaff, SucursalStaff } from '@/types/api';

export interface UsoEmpleado {
  tipo: EmpleadoMe['tipo'] | null;
  empleado: EmpleadoStaff | null;
  negocio: NegocioStaff | null;
  sucursal: SucursalStaff | null;
  autenticado: boolean;
  cargando: boolean;
  /** true una vez que se sabe si hay sesion o no (evita el flash de login). */
  resuelto: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Sesion del staff: GET /auth/empleado/me con la cookie.
 *
 * Distincion que importa:
 * - 401 => no hay sesion (o vencio): se limpia y se va a /login.
 * - Cualquier otro error (red, 500) => NO se cierra la sesion. Un backend caido no
 *   puede eyectar al empleado que esta trabajando.
 */
export function useEmpleado(): UsoEmpleado {
  const { tipo, empleado, negocio, sucursal, autenticado, cargando } = useEmpleadoStore();
  const fijarSesion = useEmpleadoStore((s) => s.fijarSesion);
  const limpiar = useEmpleadoStore((s) => s.limpiar);
  const router = useRouter();
  const [resuelto, setResuelto] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const me = await staffApi.me();
      fijarSesion(me);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status === 401) {
        limpiar();
        // Se vuelve al destino ACTUAL (con query) para no perder un `?ref=` en
        // curso. window y no useSearchParams: este hook vive en el layout y
        // useSearchParams obligaria a un <Suspense> para prerenderizar.
        const actual =
          typeof window === 'undefined' ? '/login' : `/login?volver=${encodeURIComponent(window.location.pathname + window.location.search)}`;
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
      await staffApi.logout();
    } catch {
      // Si el logout falla en el servidor, igual se limpia local: la cookie la
      // borra el backend cuando puede, y si no, vence sola.
    }
    limpiar();
    router.replace('/login');
  }, [limpiar, router]);

  return { tipo, empleado, negocio, sucursal, autenticado, cargando, resuelto, error, refetch, logout };
}
