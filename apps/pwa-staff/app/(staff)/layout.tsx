'use client'

import * as React from 'react';
import { Skeleton } from '@repo/ui';
import { BottomNav } from '@/components/BottomNav';
import { useEmpleado } from '@/hooks/useEmpleado';

/**
 * Layout de las pantallas con sesion (todo menos /login).
 *
 * El estado "resolviendo sesion" es obligatorio: sin el, la pantalla entra en
 * "no autenticado" durante el primer render (el GET /me todavia no volvio) y el
 * empleado ve un parpadeo de login antes del dashboard.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const { resuelto, autenticado } = useEmpleado();

  if (!resuelto) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  // Sin sesion: el hook ya disparo el redirect a /login. Se evita mostrar el
  // dashboard un instante (y el flash de "no autenticado").
  if (!autenticado) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  return (
    <>
      {/* pb-24 deja lugar para la barra fija + la safe-area */}
      <div className="mx-auto w-full max-w-md pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
