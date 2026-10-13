import { ApiClient, endpoints } from '@repo/api-client';
import type {
  LocalesRespuesta,
  LoginSuperAdminRespuesta,
  ResumenPlataforma,
  SuperAdminSesion,
} from '@/types/api';

/**
 * Cliente HTTP unico del panel de plataforma.
 *
 * `credentials: 'include'` ya viene en @repo/api-client: la sesion es una cookie
 * HttpOnly (`superadmin_token`, HOST-ONLY), igual que en las otras PWAs. No hay Bearer
 * ni localStorage.
 *
 * A diferencia del admin NO se configura `getTenant`: el `X-Tenant-Slug` no aplica
 * (el super-admin no pertenece a ningun local) y los endpoints de plataforma no pasan
 * por el TenantGuard del backend.
 */
export const api = new ApiClient({
  baseUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
});

export const superadminApi = {
  /** Paso 1: email + password (sin slug: la identidad del super-admin es global). */
  login: (body: { email: string; password: string }) =>
    api.post<LoginSuperAdminRespuesta>(endpoints.superadmin.login, body),

  /** Paso 2: el codigo TOTP + el challenge de 5 minutos. */
  verificar2FA: (body: { challengeToken: string; codigo: string }) =>
    api.post<LoginSuperAdminRespuesta>(endpoints.superadmin.verificar2FA, body),

  logout: () => api.post<{ ok: boolean }>(endpoints.superadmin.logout, {}),

  /** Sondeo de sesion: identidad del operador. 401 = no hay sesion. */
  me: () => api.get<SuperAdminSesion>(endpoints.superadmin.me),

  /** TODOS los locales (el backend filtra por `search`/`plan`/`activo`). */
  locales: (filtros: { search?: string; plan?: string; activo?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    return api.get<LocalesRespuesta>(`${endpoints.superadmin.locales}${q ? `?${q}` : ''}`);
  },

  resumen: () => api.get<ResumenPlataforma>(endpoints.superadmin.resumen),
};
