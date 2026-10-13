'use client';

import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { BotonCerrarSesion, NavSuperadmin } from '@/components/NavSuperadmin';

/**
 * Barra lateral del panel de plataforma.
 *
 * Desktop-only (`lg:flex`), igual que el admin: el panel del operador se usa en
 * computadora para armar los locales demo. En <1024px manda la barra superior
 * (`BarraSuperadminMobile`) con el MISMO listado (`NavSuperadmin`).
 *
 * Muestra el nombre del operador (requisito de esta fase) y, debajo, su email.
 */
export function Sidebar() {
  const { superadmin } = useSuperAdmin();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card p-4 lg:flex">
      <div className="mb-6 px-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Plataforma</p>
        <p className="truncate text-lg font-semibold">{superadmin?.nombre ?? '...'}</p>
        <p className="truncate text-xs text-muted-foreground">{superadmin?.email ?? ''}</p>
      </div>

      <NavSuperadmin className="flex-1" />

      <BotonCerrarSesion className="mt-4" />
    </aside>
  );
}
