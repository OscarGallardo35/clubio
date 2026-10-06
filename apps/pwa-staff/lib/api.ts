import { ApiClient, endpoints } from '@repo/api-client';
import type {
  EmpleadoMe,
  LoginEmpleadoRespuesta,
  RespuestaAprobacion,
  RespuestaRechazo,
  VisitaAprobada,
  VisitaPendiente,
  VisitaValidable,
} from '@/types/api';

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

/** Visitas del lado staff (los 5 endpoints que existen hoy). */
export const visitasApi = {
  /** Detalle de una solicitud por token. 404 si no existe; 403 si es de otra sucursal. */
  validar: (token: string) => api.get<VisitaValidable>(endpoints.visitas.validar(token)),

  aprobar: (token: string, body: { origen?: string } = {}) =>
    api.post<RespuestaAprobacion>(endpoints.visitas.aprobar(token), { origen: 'pwa_staff', ...body }),

  rechazar: (token: string, body: { motivo?: string }) =>
    api.post<RespuestaRechazo>(endpoints.visitas.rechazar(token), body),

  /**
   * ATENCION: `mis-aprobaciones` NO es la cola de pendientes. Devuelve las visitas
   * que YO aprobe hoy. La cola de pendientes no tiene endpoint (ver CHECKPOINT).
   */
  misAprobaciones: () =>
    api.get<{ data: VisitaAprobada[]; total: number; desde: string }>(endpoints.visitas.misAprobaciones),

  /** La cola de solicitudes vivas: la fuente de verdad de la lista del staff. */
  pendientes: () =>
    api.get<{ data: VisitaPendiente[]; total: number }>(endpoints.visitas.pendientes),

  historial: (filtros: { page?: string; pageSize?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<{ data: unknown[]; total: number }>(
      `${endpoints.visitas.historial}${qs ? `?${qs}` : ''}`,
    );
  },
};
