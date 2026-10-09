'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import { useDueno } from '@/hooks/useDueno';
import { useTenant } from '@/hooks/useTenant';
import { rutaDe } from '@/lib/tenant';

/**
 * Las secciones del panel, en UN solo lugar.
 *
 * Las que todavia no existen se muestran DESHABILITADAS, no escondidas: el dueno ve el mapa del
 * panel completo y no se come un 404 por tocar un link a medio hacer.
 *
 * Vive aca y no en el Sidebar porque lo consumen DOS contenedores: el sidebar de desktop y el menu
 * mobile. Con esto, agregar una seccion no depende de acordarse de tocar dos archivos.
 */
export const SECCIONES = [
  { ruta: '/dashboard', etiqueta: 'Dashboard', listo: true },
  { ruta: '/carta', etiqueta: 'Carta', listo: true },
  { ruta: '/personal', etiqueta: 'Personal', listo: true },
  { ruta: '/sucursales', etiqueta: 'Sucursales', listo: true },
  { ruta: '/configuracion', etiqueta: 'Configuracion', listo: true },
  { ruta: '/qr', etiqueta: 'QR', listo: true },
] as const;

export type Seccion = (typeof SECCIONES)[number];

/**
 * Devuelve la funcion que dice si una seccion esta activa.
 *
 * El pathname trae el tenant adelante (`/bar-la-esquina/carta`). Se compara contra el path sin el
 * primer segmento (y tambien contra la ruta con tenant) para que el item activo no dependa de que
 * el tenant del param y el del path coincidan.
 */
export function useSeccionActiva(): (ruta: string) => boolean {
  const pathname = usePathname();
  const tenant = useTenant();
  return React.useCallback(
    (ruta: string) => {
      const limpio = (pathname || '').replace(/\/+$/, '') || '/';
      const segmentos = limpio.split('/').filter(Boolean);
      const sinTenant = segmentos.length > 1 ? `/${segmentos.slice(1).join('/')}` : limpio;
      const conTenant = rutaDe(tenant, ruta);
      return (
        sinTenant === ruta ||
        sinTenant.startsWith(`${ruta}/`) ||
        limpio === conTenant ||
        limpio.startsWith(`${conTenant}/`)
      );
    },
    [pathname, tenant],
  );
}

/**
 * El listado de secciones. Markup y estilos UNICOS: los comparten el sidebar de desktop y el menu
 * mobile. La unica diferencia es que el mobile le pasa `onNavegar` para cerrarse al tocar un item.
 */
export function NavAdmin({
  onNavegar,
  className,
}: {
  /** Se dispara al tocar un item (el menu mobile lo usa para cerrarse). */
  onNavegar?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const activa = useSeccionActiva();
  const tenant = useTenant();

  return (
    <nav className={cn('flex flex-col gap-1', className)}>
      {SECCIONES.map((seccion) =>
        seccion.listo ? (
          <Link
            key={seccion.ruta}
            href={rutaDe(tenant, seccion.ruta)}
            // Spread condicional: con `exactOptionalPropertyTypes`, pasar `onClick={undefined}` o
            // `aria-current={undefined}` explicitamente no compila.
            {...(onNavegar ? { onClick: () => onNavegar() } : {})}
            {...(activa(seccion.ruta) ? { 'aria-current': 'page' as const } : {})}
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
  );
}

/**
 * Boton de cerrar sesion. UNICO estilo para el sidebar y el menu mobile (el sidebar lo tiene abajo;
 * el mobile tambien tiene que ofrecerlo). `onClick` es para que el menu mobile se cierre al salir.
 */
export function BotonCerrarSesion({
  onClick,
  className,
}: {
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const { logout } = useDueno();
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        void logout();
      }}
      className={cn(
        'rounded-xl px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50',
        className,
      )}
    >
      Cerrar sesion
    </button>
  );
}
