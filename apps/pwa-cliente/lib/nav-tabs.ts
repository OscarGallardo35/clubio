/**
 * Definicion y estado de la barra inferior.
 *
 * La deteccion de la tab activa es pura a proposito: se puede assertar sin montar React ni
 * depender de `usePathname`.
 *
 * Rutas reales del tenant: /[tenant]/menu (carta), /[tenant]/club (club) y /tarjeta (que todavia
 * es un placeholder, por eso vive fuera del tenant).
 */

/** Alto de la barra, en rem. Lo usa tambien el BadgeCarrito para no quedar debajo. */
export const ALTO_NAV_REM = 4

export type ClaveTab = 'carta' | 'club' | 'tarjeta'

export interface TabDef {
  /** Icono lucide ya renderizado por el componente (no se guarda el componente aca). */
  clave: ClaveTab
  etiqueta: string
  /** Ruta para el tenant dado. */
  href: (tenant: string) => string
  /** Si la tab depende de una feature del plan. */
  feature?: 'menu' | undefined
}

export const TABS: TabDef[] = [
  { clave: 'carta', etiqueta: 'Carta', href: (t) => `/${t}/menu`, feature: 'menu' },
  { clave: 'club', etiqueta: 'Club', href: (t) => `/${t}/club` },
  { clave: 'tarjeta', etiqueta: 'Mi tarjeta', href: () => '/tarjeta' },
]

/** Las tabs que corresponde mostrar segun el plan. Carta necesita la feature. */
export function tabsVisibles(menuDisponible: boolean): TabDef[] {
  return TABS.filter((t) => t.feature !== 'menu' || menuDisponible)
}

/**
 * Que tab esta activa segun el pathname. Devuelve null si es una ruta que no es de la barra
 * (por ejemplo el checkout o /dev/*), para no marcar ninguna.
 */
export function tabActiva(pathname: string, tenant?: string | null): ClaveTab | null {
  const limpio = pathname.split('?')[0]?.replace(/\/+$/, '') ?? ''
  if (limpio === '/tarjeta' || limpio.startsWith('/tarjeta/')) return 'tarjeta'
  if (tenant) {
    const base = `/${tenant}`
    if (limpio === `${base}/club` || limpio.startsWith(`${base}/club/`)) return 'club'
    if (limpio === `${base}/menu` || limpio.startsWith(`${base}/menu/`)) return 'carta'
  }
  // Sin tenant (o ruta desconocida) se cae al club: es la home del programa.
  if (limpio.endsWith('/club')) return 'club'
  if (limpio.endsWith('/menu')) return 'carta'
  return null
}
