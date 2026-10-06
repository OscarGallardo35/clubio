'use client'

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import { TABS, tabActiva, type TabStaff } from '@/lib/nav-tabs';

/**
 * Barra de navegacion inferior de la Staff.
 *
 * Mobile-first: area tactil de 56px por tab, safe-area para el notch, y el color
 * de marca sale del preset (`hsl(var(--primary))`; `var(--color-primary)` NO existe
 * y falla en silencio).
 *
 * Sin `lucide-react` (no esta instalado en las PWAs): los iconos son SVG inline.
 */
function Icono({ nombre, className }: { nombre: TabStaff['icono']; className?: string }) {
  const comunes = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (nombre === 'turnos') {
    return (
      <svg {...comunes}>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 2v4M16 2v4M3 10h18M9 15l2 2 4-4" />
      </svg>
    );
  }
  if (nombre === 'visitas') {
    return (
      <svg {...comunes}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (nombre === 'pedidos') {
    return (
      <svg {...comunes}>
        <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4z" />
        <path d="M4 6h16M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }
  return (
    <svg {...comunes}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const activa = tabActiva(pathname ?? '');

  return (
    <nav
      aria-label="Navegacion principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const activo = tab.clave === activa;
          return (
            <li key={tab.clave} className="flex-1">
              <Link
                href={tab.href}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
                  activo ? 'text-[hsl(var(--primary))]' : 'text-muted-foreground',
                )}
              >
                <Icono nombre={tab.icono} className="h-6 w-6" />
                {tab.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
