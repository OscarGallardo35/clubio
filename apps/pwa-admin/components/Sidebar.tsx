'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import { useDueno } from '@/hooks/useDueno';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';

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
  { ruta: '/dashboard', etiqueta: 'Dashboard', listo: true },
  { ruta: '/carta', etiqueta: 'Carta', listo: true },
  { ruta: '/personal', etiqueta: 'Personal', listo: true },
  { ruta: '/sucursales', etiqueta: 'Sucursales', listo: true },
  { ruta: '/configuracion', etiqueta: 'Configuracion', listo: true },
  { ruta: '/qr', etiqueta: 'QR', listo: true },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const tenant = useTenant();
  const { negocio, logout } = useDueno();

  // El pathname trae el tenant adelante (`/bar-la-esquina/carta`). Se compara contra el path sin el
  // primer segmento (y tambien contra la ruta con tenant) para que el item activo no dependa de que
  // el tenant del param y el del path coincidan.
  const limpio = (pathname || '').replace(/\/+$/, '') || '/';
  const segmentos = limpio.split('/').filter(Boolean);
  const sinTenant = segmentos.length > 1 ? `/${segmentos.slice(1).join('/')}` : limpio;
  const activa = (r: string) => {
    const conTenant = rutaDe(tenant, r);
    return (
      sinTenant === r ||
      sinTenant.startsWith(`${r}/`) ||
      limpio === conTenant ||
      limpio.startsWith(`${conTenant}/`)
    );
  };

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
              key={seccion.ruta}
              href={rutaDe(tenant, seccion.ruta)}
              className={cn(
                'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                activa(seccion.ruta) ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              {seccion.etiqueta}
            </Link>
          ) : (
            <span
              key={seccion.ruta}
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
