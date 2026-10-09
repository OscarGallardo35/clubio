import type { NegocioPublico } from '@/types/api'
import { COLOR_PRIMARIO_DEFECTO } from '@/lib/constants'

/**
 * Manifest Web App POR TENANT de la PWA del cliente.
 *
 * El `public/manifest.json` estatico es el GENERICO de Clubio: se sigue sirviendo
 * para las rutas sin tenant (`/tarjeta`, `/historial`) y como FALLBACK de los locales
 * que no tienen branding propio. El manifest con la identidad del local vive en la
 * route handler dinamica `app/[tenant]/manifest.webmanifest/route.ts`.
 *
 * La CLAVE del asunto: `metadata.manifest` se arma SIEMPRE como `/<slug>/manifest.webmanifest`
 * (ver `manifestDeTenant`), asi resuelve igual entrando por path
 * (`app.clubio.lat/que-lomitos/...`) que por subdominio (`que-lomitos.clubio.lat/...`):
 * el middleware deja pasar la ruta porque ya trae el slug, y Next la mapea al `[tenant]`.
 */

/** Manifest generico (Clubio) que sirve `public/manifest.json`. */
export const MANIFEST_GENERICO = '/manifest.json'

export interface IconosTenant {
  icon192: string
  icon512: string
  maskable: string
  apple: string
}

/** Iconos genericos de Clubio: fallback para locales sin branding propio. */
const ICONOS_GENERICO: IconosTenant = {
  icon192: '/icons/icon-192.png',
  icon512: '/icons/icon-512.png',
  maskable: '/icons/icon-maskable-512.png',
  apple: '/icons/apple-touch-icon.png',
}

/**
 * Iconos PROPIOS por tenant, versionados en `public/icons/` con prefijo `<slug>-`.
 *
 * Para sumar un local:
 *   1. Subir su marca (cuadrada) a `public/icons/<slug>-icono.jpg`.
 *   2. `python scripts/generar-iconos-tenant.py <slug>` (usa Pillow) -> genera los 4 PNG.
 *   3. Agregar la entrada aca.
 * Un slug ausente de este mapa usa los genericos de Clubio (fallback, nunca 404).
 */
const ICONOS_POR_TENANT: Record<string, IconosTenant> = {
  'que-lomitos': {
    icon192: '/icons/que-lomitos-icon-192.png',
    icon512: '/icons/que-lomitos-icon-512.png',
    maskable: '/icons/que-lomitos-icon-maskable-512.png',
    apple: '/icons/que-lomitos-apple-touch-icon.png',
  },
}

/** Iconos del tenant (o los genericos de Clubio si el local no tiene propios). */
export function iconosDeTenant(slug: string | null | undefined): IconosTenant {
  return (slug && ICONOS_POR_TENANT[slug]) || ICONOS_GENERICO
}

/** true si el local tiene iconos propios cargados. */
export function tieneIconosPropios(slug: string | null | undefined): boolean {
  return !!(slug && ICONOS_POR_TENANT[slug])
}

/**
 * Path del manifest del tenant, SIEMPRE con el slug adelante.
 * Con el slug en la URL el middleware no reescribe nada (assets/extension se
 * dejan pasar) y la route handler `[tenant]/manifest.webmanifest` lo resuelve en
 * los DOS casos: path y subdominio.
 */
export function manifestDeTenant(slug: string): string {
  return `/${slug}/manifest.webmanifest`
}

/**
 * Manifest del negocio. `name`/`short_name`= nombre del local, colores del local
 * (`colorPrimario`) e iconos del local.
 *
 * `id`, `start_url` y `scope` quedan IGUAL que el generico A PROPOSITO:
 *   - `start_url: /tarjeta` es una ruta SIN tenant que resuelve el negocio por sesion
 *     (y 307-redirige a `/<slug>/tarjeta`, que si sirve ESTE manifest): si fuera la raiz
 *     abriria el tenant por defecto.
 *   - cambiar `id` hace que una instalacion existente se vea como OTRA app.
 * Lo unico que cambia por local es la identidad visible al usuario.
 */
export function manifestDeNegocio(
  slug: string,
  negocio: NegocioPublico | null,
): Record<string, unknown> {
  const iconos = iconosDeTenant(slug)
  const color = negocio?.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const nombre = negocio?.nombre?.trim() || 'Clubio'
  const premio = negocio?.configuracion?.premioTexto?.trim()

  return {
    name: nombre,
    short_name: nombre,
    description: premio
      ? `Sumá visitas y ganá ${premio} en ${nombre}`
      : 'Suma visitas y gana premios en tus locales favoritos',
    lang: 'es-AR',
    dir: 'ltr',
    id: '/',
    start_url: '/tarjeta',
    scope: '/',
    related_applications: [{ platform: 'webapp', url: manifestDeTenant(slug) }],
    display: 'standalone',
    orientation: 'portrait',
    background_color: color,
    theme_color: color,
    categories: ['food', 'lifestyle'],
    icons: [
      { src: iconos.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: iconos.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iconos.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      {
        src: '/screenshots/carta.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Carta: pedi desde tu mesa',
      },
      {
        src: '/screenshots/tarjeta.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Tu tarjeta de sellos y premios',
      },
    ],
    shortcuts: [
      { name: 'Mi tarjeta', short_name: 'Tarjeta', url: '/tarjeta' },
      { name: 'Mi historial', short_name: 'Historial', url: '/historial' },
    ],
  }
}
