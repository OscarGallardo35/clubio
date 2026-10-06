/** Claves de storage (con namespace por negocio donde aplica). */
export const STORAGE = {
  branding: 'cliente:branding',
  sucursal: 'cliente:sucursal',
  carrito: 'cliente:carrito',
  preferencias: 'cliente:prefs',
} as const

/** Prefijo para lo que es por negocio: cliente:sucursal:<slug>. */
export const PREFIJO_NEGOCIO = 'cliente:porNegocio'

export const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'bar-la-esquina'

export const RUTAS = {
  inicio: '/',
  club: (tenant: string) => `/${tenant}/club`,
  menu: (tenant: string) => `/${tenant}/menu`,
  tarjeta: '/tarjeta',
  historial: '/historial',
  sucursales: '/seleccionar-sucursal',
  offline: '/offline',
} as const

/** Rutas que usan el fondo inmersivo (degradado de la marca). */
export const RUTAS_INMERSIVAS = ['/club', '/tarjeta'] as const

/** Parametro opcional de analitica del QR (?origen=mesa-5). */
export const PARAM_ORIGEN = 'origen'
export const PARAM_TENANT = 'tenant'
export const PARAM_SUCURSAL = 'sucursal'

export const TIEMPO_ESPERA_WS_MS = 5000
export const INTERVALO_POLLING_MS = 5000

/** Colores de marca por defecto (los pisa el negocio). */
export const COLOR_PRIMARIO_DEFECTO = '#E63946'
export const COLOR_SECUNDARIO_DEFECTO = '#F77F00'
