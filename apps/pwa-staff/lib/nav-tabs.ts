/**
 * Tabs del BottomNav de la Staff.
 *
 * 4 tabs: Turnos / Visitas / Pedidos / Perfil. La carta NO es tab: vive adentro
 * de Perfil (decision de la Fase 1, para no tener 5 tabs en un telefono).
 *
 * Las rutas se guardan SIN el tenant (`ruta`) y se arman con `rutaDe(tenant, ruta)`: la Staff es
 * multi-tenant y el slug vive en la URL (`/<tenant>/visitas`), asi que un href fijo llevaria al
 * local equivocado.
 */
export type ClaveTab = 'turnos' | 'visitas' | 'pedidos' | 'perfil';

export interface TabStaff {
  clave: ClaveTab;
  etiqueta: string;
  /** Ruta RELATIVA al tenant. */
  ruta: string;
  icono: 'turnos' | 'visitas' | 'pedidos' | 'perfil';
}

export const TABS: TabStaff[] = [
  { clave: 'turnos', etiqueta: 'Turnos', ruta: '/turnos', icono: 'turnos' },
  { clave: 'visitas', etiqueta: 'Visitas', ruta: '/visitas', icono: 'visitas' },
  { clave: 'pedidos', etiqueta: 'Pedidos', ruta: '/pedidos', icono: 'pedidos' },
  { clave: 'perfil', etiqueta: 'Perfil', ruta: '/perfil', icono: 'perfil' },
];

/**
 * Que tab esta activa segun el pathname, que ahora trae el tenant adelante
 * (`/bar-la-esquina/visitas`). Se compara el pathname completo y tambien sin el primer segmento,
 * asi funciona igual con o sin tenant.
 */
export function tabActiva(pathname: string): ClaveTab | null {
  const limpio = (pathname || '').replace(/\/+$/, '') || '/';
  const segmentos = limpio.split('/').filter(Boolean);
  const sinTenant = segmentos.length > 1 ? `/${segmentos.slice(1).join('/')}` : limpio;
  for (const tab of TABS) {
    for (const base of [limpio, sinTenant]) {
      if (base === tab.ruta || base.startsWith(`${tab.ruta}/`)) return tab.clave;
    }
  }
  return null;
}
