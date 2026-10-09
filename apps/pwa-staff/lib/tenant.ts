import { RUTA_LOGIN } from './constants';

/**
 * Tenant (slug del negocio) en la PWA Staff: vive en el PRIMER segmento de la ruta
 * (`staff.clubio.lat/bar-la-esquina/visitas`).
 *
 * Sin el slug en la URL el aislamiento no es real: el dueno de dos locales veia la misma
 * pantalla y dependia de que el backend recordara su negocio. Con `[tenant]` en el path, la
 * pantalla que se mira y el negocio del token se pueden comparar.
 *
 * Lo que NO es esto: una frontera de seguridad. La cookie es HttpOnly y la firma del token la
 * valida el BACKEND en cada request (el negocio sale del token, nunca del path). Aca solo se evita
 * que alguien con sesion vea la UI de otro local.
 */

/** Segmentos que NO son tenants: rutas propias del app y hosts reservados. */
const RESERVADOS = new Set(['login', 'api', '_next', 'favicon.ico', 'www', 'app', 'staff', 'admin', 'localhost']);

/** Un slug valido: minusculas, numeros y guiones (mismo criterio que el backend). */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Tenant del path, o `null` si el primer segmento no es un tenant. */
export function tenantDePath(pathname: string | null | undefined): string | null {
  const seg = (pathname ?? '').split('/').filter(Boolean)[0];
  if (!seg) return null;
  const s = seg.toLowerCase();
  if (RESERVADOS.has(s) || !SLUG.test(s)) return null;
  return s;
}

/** Arma una ruta absoluta del tenant: `rutaDe('bar-la-esquina', '/visitas')`. */
export function rutaDe(tenant: string, ruta: string): string {
  const limpia = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return `/${tenant}${limpia === '/' ? '' : limpia}`;
}

/** La ruta de login de un tenant. */
export function rutaLogin(tenant: string): string {
  return `${rutaDe(tenant, RUTA_LOGIN)}`;
}

/**
 * Slug del negocio LEIDO del token (sin verificar la firma).
 *
 * El token es un JWT y su payload se puede decodificar sin el secret: alcanza para comparar el
 * negocio del que viene la sesion con el de la URL. Un token falsificado pasaria este chequeo y
 * rebotaria igual en el backend, que SI verifica la firma y resuelve el negocio del token: por eso
 * esto es UX (no mandar a nadie a la UI de otro local) y no una defensa.
 */
export function slugDelToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64)) as { negocioSlug?: unknown };
    return typeof json?.negocioSlug === 'string' ? json.negocioSlug : null;
  } catch {
    return null;
  }
}
