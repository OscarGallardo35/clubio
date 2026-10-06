import type { ClienteMe, NegocioPublico } from '@/types/api'

/**
 * Base URL para las llamadas del SERVIDOR.
 *
 * En Docker/Railway el backend no vive en la misma URL publica que ve el
 * navegador, asi que se permite una variable interna. Si no esta, se usa la
 * publica (caso local).
 */
export const API_URL_SERVIDOR = (
  process.env.API_URL_INTERNA ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3000'
).replace(/\/$/, '')

/**
 * Resuelve el negocio en el SERVIDOR, antes del primer render.
 * Devolverlo desde el layout evita el flash de "sin color": el HTML ya sale con
 * el branding aplicado.
 */
export async function getNegocio(slug: string): Promise<NegocioPublico | null> {
  try {
    const res = await fetch(`${API_URL_SERVIDOR}/api/negocios/publico/${encodeURIComponent(slug)}`, {
      // 30s de cache: el branding cambia poco y no vale un round-trip por request.
      next: { revalidate: 30 },
    })
    if (!res.ok) return null
    return (await res.json()) as NegocioPublico
  } catch {
    // El layout decide que mostrar; no se rompe la pagina por un fetch fallido.
    return null
  }
}

/**
 * GET /auth/cliente/me desde el SERVIDOR, reenviando la cookie del cliente.
 *
 * Sirve para las rutas que no tienen tenant en la URL (/tarjeta, /historial):
 * el negocio al que pertenece el cliente sale de la sesion, y asi el primer
 * render ya trae el branding (sin flash).
 *
 * cache: 'no-store' NO es opcional: la respuesta depende de la cookie, cachearla
 * filtraria la sesion de un cliente a otro.
 */
export async function getClienteMe(cookie: string | null | undefined): Promise<ClienteMe | null> {
  if (!cookie) return null
  try {
    const res = await fetch(`${API_URL_SERVIDOR}/api/auth/cliente/me`, {
      headers: { cookie },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as ClienteMe
  } catch {
    return null
  }
}
