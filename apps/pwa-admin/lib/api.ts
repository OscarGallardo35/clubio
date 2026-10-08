import { ApiClient, endpoints } from '@repo/api-client';
import type { DuenoSesion, FeaturePlan, LoginDuenoRespuesta, NegocioAdmin } from '@/types/api';

/**
 * Cliente HTTP unico de la PWA Admin.
 *
 * `credentials: 'include'` ya viene en @repo/api-client: la sesion del dueno es una cookie
 * HttpOnly (`dueno_token`), igual que la del staff y la del cliente. No hay Bearer ni
 * localStorage: la cookie es la unica fuente de verdad.
 *
 * El tenant NO va en la URL ni en un header: el backend lo saca del token. El `X-Tenant-Slug`
 * solo lo usan los endpoints PUBLICOS (el menu del cliente), y el admin no consume ninguno.
 */
export const api = new ApiClient({
  baseUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
});

export const duenoApi = {
  /** Paso 1 del login: email + password + el slug del negocio (el email no es unico global). */
  login: (body: { email: string; password: string; negocioSlug: string }) =>
    api.post<LoginDuenoRespuesta>(endpoints.auth.loginDueno, body),

  /** Paso 2: el codigo TOTP + el challenge de 5 minutos. */
  verificar2FA: (body: { challengeToken: string; codigo: string }) =>
    api.post<LoginDuenoRespuesta>(endpoints.auth.verificar2FA, body),

  logout: () => api.post<{ ok: boolean }>(endpoints.auth.logoutDueno, {}),

  /**
   * Sondeo de sesion (`GET /auth/dueno/me`): identidad del dueno + su negocio con las features
   * del plan. Antes de la Fase 0c esto usaba `mi-negocio`, que trae campos de administracion de
   * mas y no dice quien es el que esta mirando.
   */
  me: () => api.get<DuenoSesion>(endpoints.auth.meDueno),
};

export const negociosApi = {
  miNegocio: () => api.get<NegocioAdmin>(endpoints.negocios.miNegocio),
  features: () => api.get<FeaturePlan[]>(endpoints.negocios.features),
  /** El QR del negocio: lo que el local imprime para sus clientes. */
  qrInfo: () => api.get<{ urlCliente: string; urlStaff: string }>(endpoints.negocios.qrInfo),
  actualizar: (body: { nombre?: string; telefono?: string }) =>
    api.patch<NegocioAdmin>(endpoints.negocios.update, body),
};

export const sucursalesApi = {
  /** `mis-sucursales` respeta el alcance por rol (en el admin siempre son todas las del negocio). */
  listar: () => api.get<{ data: unknown[]; total: number }>(endpoints.sucursales.misSucursales),
  obtener: (id: string) => api.get<unknown>(endpoints.sucursales.get(id)),
  crear: (body: { nombre: string; direccion?: string; telefono?: string }) =>
    api.post<{ id: string }>(endpoints.sucursales.create, body),
  actualizar: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(endpoints.sucursales.update(id), body),
  marcarPrincipal: (id: string) => api.patch<{ ok: boolean }>(endpoints.sucursales.principal(id)),
  eliminar: (id: string) => api.delete<{ ok: boolean }>(endpoints.sucursales.delete(id)),
};

export const empleadosApi = {
  listar: () => api.get<{ data: unknown[]; total: number }>(endpoints.empleados.list),
  obtener: (id: string) => api.get<unknown>(endpoints.empleados.get(id)),
  crear: (body: { nombre: string; rol: string; sucursalId: string; pin: string }) =>
    api.post<{ id: string }>(endpoints.empleados.create, body),
  actualizar: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(endpoints.empleados.update(id), body),
  /** 409 si ese PIN ya lo usa otro empleado del mismo negocio. */
  resetPin: (id: string, pin: string) => api.patch<{ ok: boolean }>(endpoints.empleados.resetPin(id), { pin }),
  eliminar: (id: string) => api.delete<{ ok: boolean }>(endpoints.empleados.delete(id)),
};

export const cartaApi = {
  /** Ya viene agrupado por categoria: `{ total, categorias: [{ categoria, items }] }`. */
  admin: (filtros: { categoria?: string; search?: string; disponible?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return api.get<unknown>(`${endpoints.carta.admin}${q ? `?${q}` : ''}`);
  },
  /** Prende/apaga un item del NEGOCIO (no hay override por sucursal en este endpoint). */
  disponibilidad: (id: string, disponible: boolean) =>
    api.patch<{ id: string; disponible: boolean }>(endpoints.carta.disponibilidad(id), { disponible }),
  actualizar: (id: string, body: Record<string, unknown>) =>
    api.patch<{ id: string }>(endpoints.carta.update(id), body),
  crear: (body: Record<string, unknown>) => api.post<{ id: string }>(endpoints.carta.create, body),
  eliminar: (id: string) => api.delete<{ ok: boolean }>(endpoints.carta.delete(id)),
};

export const configuracionApi = {
  obtener: () => api.get<Record<string, unknown>>(endpoints.configuracion.get),
  efectiva: () => api.get<Record<string, unknown>>(endpoints.configuracion.efectiva),
  actualizar: (body: Record<string, unknown>) =>
    api.patch<Record<string, unknown>>(endpoints.configuracion.update, body),
};

export const planesApi = {
  miPlan: () => api.get<Record<string, unknown>>(endpoints.planes.miPlan),
  usoMensual: () => api.get<Record<string, unknown>>(endpoints.planes.usoMensual),
  usoMensualHistorico: () => api.get<Record<string, unknown>>(endpoints.planes.usoMensualHistorico),
  features: () => api.get<FeaturePlan[]>(endpoints.planes.features),
};

export const estadisticasApi = {
  /** Cacheado en Redis del lado del backend. */
  dashboard: () => api.get<Record<string, unknown>>(endpoints.estadisticas.dashboard),
  topClientes: () => api.get<{ data: unknown[] }>(endpoints.estadisticas.topClientes),
};
