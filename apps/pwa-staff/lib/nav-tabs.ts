/**
 * Tabs del BottomNav de la Staff.
 *
 * 4 tabs: Turnos / Visitas / Pedidos / Perfil. La carta NO es tab: vive adentro
 * de Perfil (decision de la Fase 1, para no tener 5 tabs en un telefono).
 */
export type ClaveTab = 'turnos' | 'visitas' | 'pedidos' | 'perfil';

export interface TabStaff {
  clave: ClaveTab;
  etiqueta: string;
  href: string;
  icono: 'turnos' | 'visitas' | 'pedidos' | 'perfil';
}

export const TABS: TabStaff[] = [
  { clave: 'turnos', etiqueta: 'Turnos', href: '/turnos', icono: 'turnos' },
  { clave: 'visitas', etiqueta: 'Visitas', href: '/visitas', icono: 'visitas' },
  { clave: 'pedidos', etiqueta: 'Pedidos', href: '/pedidos', icono: 'pedidos' },
  { clave: 'perfil', etiqueta: 'Perfil', href: '/perfil', icono: 'perfil' },
];

/** Que tab esta activa segun el pathname. La raiz y /turnos marcan Turnos. */
export function tabActiva(pathname: string): ClaveTab | null {
  const limpio = (pathname || '').replace(/\/+$/, '') || '/';
  for (const tab of TABS) {
    if (limpio === tab.href || limpio.startsWith(`${tab.href}/`)) return tab.clave;
  }
  return null;
}
