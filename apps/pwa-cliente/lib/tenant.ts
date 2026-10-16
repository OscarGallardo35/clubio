// La extension `.ts` es la misma convencion que `lib/checkout-maquina.ts`: permite que los checks de
// node (scripts/check-tenant.mts) importen este modulo puro, porque node ESM no resuelve un
// especificador sin extension (y Next lo resuelve igual: allowImportingTsExtensions).
import { DEFAULT_TENANT, PARAM_TENANT, PARAM_SUCURSAL, PARAM_ORIGEN } from './constants.ts'

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
/**
 * El `code` que el backend DEBERIA mandar en el body del 403 por tenant.
 *
 * Ver el docblock de `esTenantMismatch`: hoy el `ForbiddenException` del `TenantGuard` sale como
 * `{ statusCode: 403, message: 'El tenant del token no coincide con la solicitud', error: 'Forbidden' }`,
 * o sea SIN un campo estable que lo distinga de cualquier otro 403. Hasta que el backend agregue
 * `code: 'TENANT_MISMATCH'`, este camino queda como el criterio PRINCIPAL (listo para el dia que
 * exista) y el texto de abajo es el fallback efectivo.
 */
export const CODIGO_TENANT_MISMATCH = 'TENANT_MISMATCH'

/**
 * true si el backend rechazo la request porque la SESION es de otro negocio.
 *
 * El `TenantGuard` del backend compara el `negocioSlug` del token con el tenant pedido y responde
 * 403 con ese mensaje. Para el cliente no es un error de red ni un fallo de la app: significa
 * "estas logueado en otro local", y merece un CTA para cambiar de cuenta, no un cartel de fallo.
 * La cookie es HttpOnly, asi que no se puede limpiar desde el navegador: hay que pasar por el
 * logout del backend.
 *
 * CRITERIO, en orden (y por que):
 *  1. `code === 'TENANT_MISMATCH'` — el unico campo que seria estable. OJO: HOY NO EXISTE
 *     (verificado contra `apps/backend/src/common/guards/tenant.guard.ts`: lanza
 *     `new ForbiddenException('…')` y Nest arma el body sin `code`). El `error: 'Forbidden'` del
 *     body NO sirve como criterio: lo comparte cualquier 403 de la API.
 *  2. el TEXTO del mensaje — lo unico que hay hoy. Es fragil a proposito documentado: se rompe el
 *     dia que alguien reescriba el mensaje en el backend. Por eso el paso 1 va primero y esta
 *     comentado como pedido: **falta `code: 'TENANT_MISMATCH'` del lado del backend**.
 */
export function esTenantMismatch(status: number, mensaje?: string | null, datos?: unknown): boolean {
  if (status !== 403) return false
  const code = datos && typeof datos === 'object' ? (datos as { code?: unknown }).code : undefined
  if (code === CODIGO_TENANT_MISMATCH) return true
  return /no coincide con la solicitud/i.test(mensaje ?? '')
}

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

/**
 * Tenant de la URL, SINCRONICO: lo que va en el header `X-Tenant-Slug` de cada request.
 *
 * Existe por un bug real de orden: el tenant se fijaba con `api.setTenant(slug)` dentro de un
 * `useEffect` del `BrandingProvider` (el padre), y los efectos de React corren de HIJO a PADRE. En
 * cada carga en frio la PRIMERA request salia sin el header, el `TenantGuard` del backend la
 * respondia con el tenant DEL TOKEN (falla abierto) y la app mostraba por un instante datos de OTRO
 * local antes de que la siguiente request cortara con el 403. Resolviendolo desde la URL no hay
 * ventana: la primera request ya viaja con el header correcto.
 *
 * ORDEN: **subdominio primero, despues el path**. No es arbitrario:
 *  - En el subdominio (`nonona-lomos.clubio.lat`) la URL del navegador puede NO traer el slug
 *    (`/club`, `/menu`): el middleware reescribe a `/[tenant]/club` sin cambiar la barra de
 *    direcciones. Con el path primero, `tenantDelPath('/club')` devolveria `'club'` (que no es un
 *    local) y el header saldria mal en TODAS las requests.
 *  - El middleware (`middleware.ts`) usa el MISMO `tenantDelSubdominio` para reescribir, asi que el
 *    subdominio es la fuente autoritativa cuando existe: resolver igual que el middleware es lo que
 *    mantiene coherente el header con la pantalla que se esta renderizando.
 *  - En el path (`app.clubio.lat/<slug>/club`) el subdominio es `app`/`www`/`api` (reservado) o no
 *    hay subdominio (localhost, preview): devuelve `null` y manda el primer segmento de la ruta.
 *
 * Devuelve `null` en las rutas de la RAIZ sin tenant (`/tarjeta`, `/historial`,
 * `/seleccionar-sucursal`, `/offline`, `/dev`) y en `/`: ahi el header queda como estaba (lo fija el
 * `BrandingProvider` si conoce el negocio) y el comportamiento no cambia.
 */
export function resolverTenantSincrono(
  pathname: string | null | undefined,
  hostname: string | null | undefined,
): string | null {
  return tenantDelSubdominio(hostname) ?? tenantDelPath(pathname) ?? null
}

/** Parametros de analitica que viajan con el QR. */
export function leerParametrosQr(search: string | null | undefined) {
  const sp = new URLSearchParams(search ?? '')
  return {
    origen: sp.get(PARAM_ORIGEN),
    sucursalSlug: sp.get(PARAM_SUCURSAL),
  }
}
