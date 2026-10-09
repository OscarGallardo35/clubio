'use client';

import * as React from 'react';
import { useDueno } from '@/hooks/useDueno';
import { MenuAdminMobile } from '@/components/MenuAdminMobile';

/**
 * Barra superior del admin en mobile (`< 1024px`).
 *
 * El sidebar es desktop-only (`lg:flex`): sin esta barra, en el celular el panel no tenia NINGUNA
 * navegacion. Muestra el negocio y un boton hamburguesa que abre el mismo listado del sidebar
 * (`NavAdmin`) dentro de un `BottomSheet`.
 *
 * En `>=1024px` no se renderiza (`lg:hidden`): el desktop queda igual que antes.
 */
export function BarraAdminMobile() {
  const { negocio } = useDueno();
  const [abierto, setAbierto] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 border-b bg-card px-3 py-2 lg:hidden">
      <button
        type="button"
        aria-label="Abrir menu de navegacion"
        aria-expanded={abierto}
        onClick={() => setAbierto(true)}
        className="-ml-1 rounded-lg p-2 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">Panel de</p>
        <p className="truncate text-sm font-semibold leading-tight">{negocio?.nombre ?? '...'}</p>
      </div>

      <MenuAdminMobile abierto={abierto} onCerrar={() => setAbierto(false)} />
    </header>
  );
}
