import { ApiClient, endpoints } from '@repo/api-client';
import type {
  ActualizarItemCartaBody,
  CartaAdminRespuesta,
  EmpleadoMe,
  ItemCarta,
  EstadoPedido,
  Paginado,
  PedidoStaff,
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

/** Pedidos del lado staff. */
export const pedidosApi = {
  /**
   * Listado de pedidos. SIN `estado` devuelve los ACTIVOS (PENDIENTE..ENVIADO):
   * el backend filtra por ESTADOS_ACTIVOS cuando no se le pasa nada.
   */
  listar: (filtros: { estado?: string; tipo?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return api.get<Paginado<PedidoStaff>>(`${endpoints.pedidos.list}${q ? `?${q}` : ''}`);
  },

  obtener: (id: string) => api.get<PedidoStaff>(endpoints.pedidos.get(id)),

  /** `motivo` es obligatorio (min 10) solo cuando estado = RECHAZADO. */
  cambiarEstado: (id: string, body: { estado: EstadoPedido; motivo?: string }) =>
    api.patch<{ id: string; estado: EstadoPedido }>(endpoints.pedidos.estado(id), body),

  /** Solo funciona con `configuracion.modoAsignacionPedidos = BROADCAST`. 409 si otro lo tomo. */
  tomar: (id: string) => api.patch<{ ok: true; yaAsignado?: boolean }>(endpoints.pedidos.tomar(id)),

  historial: (filtros: { page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(filtros).map(([k, v]) => [k, String(v)]));
    const q = qs.toString();
    return api.get<Paginado<PedidoStaff>>(`${endpoints.pedidos.historial}${q ? `?${q}` : ''}`);
  },

  estadisticas: () => api.get<Record<string, unknown>>(endpoints.pedidos.estadisticas),
};

/**
 * Carta del lado staff.
 *
 * `admin` y las mutaciones estan detras de `@RequiereFeature('menu')` + PlanGuard y
 * son de rol DUENO/ENCARGADO: un MESERO recibe 403. La pantalla lo checa ANTES de
 * mostrar los controles.
 */
export const cartaApi = {
  admin: (filtros: { categoria?: string; search?: string; disponible?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    // Devuelve { total, categorias: [{categoria, items}] }: ya viene AGRUPADO por categoria.
    return api.get<CartaAdminRespuesta>(`${endpoints.carta.admin}${q ? `?${q}` : ''}`);
  },

  /**
   * Prende/apaga un item. Afecta al item del NEGOCIO (no hay override por sucursal
   * en este endpoint): lo que se apaga aca desaparece de TODAS las sucursales.
   */
  disponibilidad: (id: string, disponible: boolean) =>
    api.patch<Pick<ItemCarta, 'id' | 'nombre' | 'disponible'>>(
      endpoints.carta.disponibilidad(id),
      { disponible },
    ),

  actualizar: (id: string, body: ActualizarItemCartaBody) =>
    api.patch<ItemCarta>(endpoints.carta.update(id), body),
};
