import { ApiClient, endpoints } from '@repo/api-client'
import type { ClienteMe, CartaPublica, EstadoVisitaRespuesta, MiTarjetaRespuesta, Paginado, VisitaHistorial, NegocioPublico, SolicitarVisitaBody, SolicitarVisitaRespuesta } from '@/types/api'

/**
 * Cliente HTTP unico de la PWA.
 *
 * - `credentials: 'include'` ya viene en @repo/api-client: la sesion del cliente
 *   es una cookie HttpOnly, no un token en localStorage.
 * - El tenant se fija con `api.setTenant(slug)` cuando el branding se resuelve
 *   (lo hace BrandingProvider), asi que aca no hay dependencia de los stores.
 */
export const api = new ApiClient({
  baseUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
})

export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000').replace(/\/$/, '')

/** Atajos tipados de los endpoints que ya usamos. */
export const clienteApi = {
  /** 401 => no hay sesion: la PWA muestra el registro. */
  me: () => api.get<ClienteMe>(endpoints.auth.meCliente),
  logout: () => api.post<void>(endpoints.auth.logoutCliente),
  registrar: (body: { nombre: string; telefono: string; negocioSlug: string; sucursalSlug?: string | undefined }) =>
    api.post<ClienteMe & { accessToken: string }>(endpoints.auth.registrarCliente, body),
  recuperar: (body: { telefono: string; negocioSlug: string }) =>
    api.post<{ accessToken: string }>(endpoints.auth.recuperarCliente, body),
}

export const negocioApi = {
  publico: (slug: string, sucursalSlug?: string | null) =>
    api.get<NegocioPublico>(
      `${endpoints.negocios.publico(slug)}${sucursalSlug ? `?sucursalSlug=${encodeURIComponent(sucursalSlug)}` : ''}`,
    ),
  sucursalesPublicas: () => api.get<{ data: NegocioPublico['sucursales']; total: number }>(endpoints.sucursales.publico),
}

export const cartaApi = {
  publica: (sucursalSlug?: string | null) =>
    api.get<CartaPublica>(`${endpoints.carta.list}${sucursalSlug ? `?sucursalSlug=${encodeURIComponent(sucursalSlug)}` : ''}`),
}

export const visitasApi = {
  solicitar: (body: SolicitarVisitaBody) => api.post<SolicitarVisitaRespuesta>(endpoints.visitas.solicitar, body),
  estado: (token: string) => api.get<EstadoVisitaRespuesta>(endpoints.visitas.estado(token)),
  miTarjeta: (sucursalSlug?: string | null) =>
    api.get<MiTarjetaRespuesta>(
      `${endpoints.visitas.miTarjeta}${sucursalSlug ? `?sucursalSlug=${encodeURIComponent(sucursalSlug)}` : ''}`,
    ),
  miHistorial: (opts?: { page?: number; pageSize?: number; sucursalSlug?: string | null }) => {
    const sp = new URLSearchParams()
    if (opts?.page) sp.set('page', String(opts.page))
    if (opts?.pageSize) sp.set('pageSize', String(opts.pageSize))
    if (opts?.sucursalSlug) sp.set('sucursalSlug', opts.sucursalSlug)
    const qs = sp.toString()
    return api.get<Paginado<VisitaHistorial>>(`${endpoints.visitas.miHistorial}${qs ? `?${qs}` : ''}`)
  },
}
