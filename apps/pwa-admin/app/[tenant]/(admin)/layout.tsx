'use client';

import * as React from 'react';
import { Skeleton } from '@repo/ui';
import { Sidebar } from '@/components/Sidebar';
import { BarraAdminMobile } from '@/components/BarraAdminMobile';
import { useDueno } from '@/hooks/useDueno';

/**
 * Layout de las pantallas con sesion (todo menos /login).
 *
 * Mismo criterio que la PWA Staff: el estado "resolviendo sesion" es obligatorio. Sin el, el
 * primer render entra en "no autenticado" (la request todavia no volvio) y el dueno ve un
 * parpadeo de login antes del panel.
 *
 * Desktop: barra lateral fija a la izquierda. No hay bottom nav: el admin se usa sentado en una
 * computadora (la staff es la que se usa parada, con el celular).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { resuelto, autenticado } = useDueno();

  if (!resuelto || !autenticado) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Mobile (<1024px): barra superior con hamburguesa. En desktop se oculta (`lg:hidden`). */}
      <BarraAdminMobile />
      <Sidebar />
      {/* min-w-0: sin esto una tabla ancha estira el flex y desborda la pantalla. */}
      <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
