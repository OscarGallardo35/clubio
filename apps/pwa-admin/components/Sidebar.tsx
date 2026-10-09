'use client';

import * as React from 'react';
import { useDueno } from '@/hooks/useDueno';
import { BotonCerrarSesion, NavAdmin } from '@/components/NavAdmin';

/**
 * Barra lateral del admin.
 *
 * Desktop-only (`lg:flex`): el admin se usa en computadora. El listado de secciones vive en
 * `NavAdmin` (compartido) para que el menu mobile use EXACTAMENTE lo mismo. En <1024px no se
 * renderiza: ahi manda la barra superior (`BarraAdminMobile`).
 */
export function Sidebar() {
  const { negocio } = useDueno();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card p-4 lg:flex">
      <div className="mb-6 px-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Panel de</p>
        <p className="truncate text-lg font-semibold">{negocio?.nombre ?? '...'}</p>
      </div>

      <NavAdmin className="flex-1" />

      <BotonCerrarSesion className="mt-4" />
    </aside>
  );
}
