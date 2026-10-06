'use client'

/**
 * Barra inferior de la PWA del cliente.
 *
 * Las tabs visibles dependen del plan: "Carta" solo aparece si el negocio tiene el menu activo.
 * z-40 a proposito: el BadgeCarrito (z-50) tiene que quedar por encima.
 */
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { ALTO_NAV_REM, tabActiva, tabsVisibles } from '@/lib/nav-tabs'
import type { ClaveTab } from '@/lib/nav-tabs'
import { useBranding } from '@/hooks/useBranding'

/**
 * Iconos inline a proposito: `lucide-react` no es dependencia de esta app y no se agrega una sin
 * que lo decidan. Si se instala, se reemplazan estas 3 funciones y el resto no cambia.
 * Trazo 24x24 tomado del set de lucide (ShoppingBag, Award, User).
 */
type IconoProps = { className?: string | undefined }

const ICONOS: Record<ClaveTab, (p: IconoProps) => JSX.Element> = {
  carta: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  club: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  tarjeta: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
}

export function BottomNav() {
  const pathname = usePathname()
  const params = useParams<{ tenant?: string }>()
  const tenant = params?.tenant
  const { menuDisponible } = useBranding()

  const tabs = tabsVisibles(menuDisponible)
  const activa = tabActiva(pathname ?? '', tenant)

  return (
    <nav
      aria-label="Navegacion principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {tabs.map((tab) => {
          const Icono = ICONOS[tab.clave]
          const esActiva = activa === tab.clave
          const href = tab.clave === 'tarjeta' || !tenant ? tab.href(tenant ?? '') : tab.href(tenant)
          return (
            <li key={tab.clave} className="flex-1">
              <Link
                href={href}
                aria-current={esActiva ? 'page' : undefined}
                className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs"
                style={esActiva ? { color: 'var(--color-primary)' } : undefined}
              >
                <Icono className="size-6" />
                <span className={esActiva ? 'font-medium' : 'text-muted-foreground'}>{tab.etiqueta}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {/* El alto real lo usa el BadgeCarrito: no se repite el numero en dos lados. */}
      <span className="hidden" data-alto-nav-rem={ALTO_NAV_REM} />
    </nav>
  )
}
