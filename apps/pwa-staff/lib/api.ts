import { ApiClient, endpoints } from '@repo/api-client';
import type { EmpleadoMe, LoginEmpleadoRespuesta } from '@/types/api';

/**
 * Cliente HTTP unico de la PWA Staff.
 *
 * `credentials: 'include'` ya viene en @repo/api-client: la sesion del staff es una
 * cookie HttpOnly (`empleado_token`), igual que la del cliente.
 *
 * El tenant NO va en la URL: negocio y sucursal salen del token. Por eso aca no
 * hay `setTenant`.
 */
export const api = new ApiClient({
  baseUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
});

export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const staffApi = {
  login: (body: { negocioSlug: string; pin: string }) =>
    api.post<LoginEmpleadoRespuesta>(endpoints.auth.loginEmpleado, body),
  logout: () => api.post<{ ok: boolean }>(endpoints.auth.logoutEmpleado, {}),
  /** 401 => no hay sesion (es un estado, no un error). */
  me: () => api.get<EmpleadoMe>(endpoints.auth.meEmpleado),
};
