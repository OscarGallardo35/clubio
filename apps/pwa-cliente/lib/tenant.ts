import { DEFAULT_TENANT, PARAM_TENANT, PARAM_SUCURSAL, PARAM_ORIGEN } from './constants'

/** Subdominios que NO son tenants (mismo criterio que el TenantGuard del backend). */
const RESERVADOS = new Set(['app', 'staff', 'admin', 'api', 'www', 'localhost'])

/**
 * Tenant (slug del negocio). Orden:
 *   1. el segmento [tenant] de la ruta (los QRs entran por ahi)
 *   2. el subdominio (bar-slug.dominio.com)
 *   3. ?tenant= (solo desarrollo)
 *   4. NEXT_PUBLIC_DEFAULT_TENANT
 *
 * En el servidor no hay window: se devuelve el default y el segmento de la ruta
 * lo resuelve el layout, que si lo tiene como param.
 */
export function tenantDelPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const seg = pathname.split('/').filter(Boolean)[0]
  if (!seg) return null
  if (seg === 'tarjeta' || seg === 'historial' || seg === 'seleccionar-sucursal' || seg === 'offline' || seg === 'dev') {
    return null
  }
  return seg
}

export function tenantDelSubdominio(hostname: string | undefined | null): string | null {
  if (!hostname) return null
  const partes = hostname.split('.')
  if (partes.length < 3) return null
  const sub = (partes[0] ?? '').toLowerCase()
  return RESERVADOS.has(sub) ? null : sub
}

export function tenantDelQuery(search: string | null | undefined): string | null {
  if (!search) return null
  return new URLSearchParams(search).get(PARAM_TENANT)
}

/** Resuelve el tenant en el cliente (en el servidor devuelve el default). */
export function resolverTenant(pathname?: string, hostname?: string, search?: string): string {
  if (typeof window === 'undefined') return tenantDelPath(pathname) ?? DEFAULT_TENANT
  return (
    tenantDelPath(pathname ?? window.location.pathname) ??
    tenantDelSubdominio(hostname ?? window.location.hostname) ??
    tenantDelQuery(search ?? window.location.search) ??
    DEFAULT_TENANT
  )
}

/** Parametros de analitica que viajan con el QR. */
export function leerParametrosQr(search: string | null | undefined) {
  const sp = new URLSearchParams(search ?? '')
  return {
    origen: sp.get(PARAM_ORIGEN),
    sucursalSlug: sp.get(PARAM_SUCURSAL),
  }
}
