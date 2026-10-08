'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import { useDueno } from '@/hooks/useDueno';

/**
 * Barra lateral del admin.
 *
 * Las secciones que todavia no existen se muestran DESHABILITADAS, no escondidas: el dueno ve el
 * mapa del panel completo y no se come un 404 por tocar un link a medio hacer.
 *
 * Desktop-only (`lg:flex`): el admin se usa en computadora. En pantallas chicas el `main` ocupa
 * todo el ancho; si en algun momento hace falta, entra una barra superior con el mismo listado.
 */
const SECCIONES = [
  { href: '/', etiqueta: 'Dashboard', listo: true },
  { href: '/carta', etiqueta: 'Carta', listo: true },
  { href: '/personal', etiqueta: 'Personal', listo: false },
  { href: '/sucursales', etiqueta: 'Sucursales', listo: false },
  { href: '/configuracion', etiqueta: 'Configuracion', listo: false },
  { href: '/qr', etiqueta: 'QR', listo: false },
] as const;

export function Sidebar() {
  const ruta = usePathname();
  const { negocio, logout } = useDueno();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card p-4 lg:flex">
      <div className="mb-6 px-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Panel de</p>
        <p className="truncate text-lg font-semibold">{negocio?.nombre ?? '...'}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {SECCIONES.map((seccion) =>
          seccion.listo ? (
            <Link
              key={seccion.href}
              href={seccion.href}
              className={cn(
                'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                ruta === seccion.href ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              {seccion.etiqueta}
            </Link>
          ) : (
            <span
              key={seccion.href}
              aria-disabled="true"
              className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-muted-foreground/60"
            >
              {seccion.etiqueta}
              <span className="text-xs">pronto</span>
            </span>
          ),
        )}
      </nav>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-4 rounded-xl px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50"
      >
        Cerrar sesion
      </button>
    </aside>
  );
}
