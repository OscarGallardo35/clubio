'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';

/**
 * Las secciones del panel de plataforma, en UN solo lugar.
 *
 * Igual que en el admin: lo que todavia no existe se muestra DESHABILITADO, no
 * escondido — el operador ve el mapa del panel completo y no se come un 404 por tocar
 * un link a medio hacer. En esta fase (Fase 0) solo hay dos pantallas cableadas; el
 * resto (crear local demo, planes, auditoria, impersonar) se agrega despues.
 *
 * Vive aca y no en el Sidebar porque lo consumen DOS contenedores: el sidebar de
 * desktop y el menu mobile.
 */
export const SECCIONES = [
  { ruta: '/locales', etiqueta: 'Locales', listo: true },
  { ruta: '/resumen', etiqueta: 'Resumen', listo: true },
  { ruta: '/demos', etiqueta: 'Crear demo', listo: false },
  { ruta: '/planes', etiqueta: 'Planes', listo: false },
  { ruta: '/auditoria', etiqueta: 'Auditoria', listo: false },
] as const;

export type Seccion = (typeof SECCIONES)[number];

/**
 * Dice si una seccion esta activa.
 *
 * Sin tenant el pathname es DIRECTO (`/locales`), asi que la comparacion es simple:
 * ruta exacta o prefijo. (En el admin hay que descontar el primer segmento porque el
 * slug vive en la URL; aca no hay slug.)
 */
export function useSeccionActiva(): (ruta: string) => boolean {
  const pathname = usePathname();
  return React.useCallback(
    (ruta: string) => {
      const limpio = (pathname || '').replace(/\/+$/, '') || '/';
      return limpio === ruta || limpio.startsWith(`${ruta}/`);
    },
    [pathname],
  );
}

/**
 * El listado de secciones. Markup y estilos UNICOS: los comparten el sidebar de
 * desktop y el menu mobile (que le pasa `onNavegar` para cerrarse al tocar un item).
 */
export function NavSuperadmin({
  onNavegar,
  className,
}: {
  onNavegar?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const activa = useSeccionActiva();

  return (
    <nav className={cn('flex flex-col gap-1', className)}>
      {SECCIONES.map((seccion) =>
        seccion.listo ? (
          <Link
            key={seccion.ruta}
            href={seccion.ruta}
            // Spread condicional: con `exactOptionalPropertyTypes`, pasar
            // `onClick={undefined}` explicitamente no compila.
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
 * Boton de cerrar sesion. UNICO estilo para el sidebar y el menu mobile.
 * `onClick` es para que el menu mobile se cierre al salir.
 */
export function BotonCerrarSesion({
  onClick,
  className,
}: {
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const { logout } = useSuperAdmin();
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
