import { ApiClient, endpoints } from '@repo/api-client';
import type {
  ActualizarConfiguracionBody,
  ActualizarEmpleadoBody,
  ActualizarItemCartaBody,
  ActualizarSucursalBody,
  CartaAdminRespuesta,
  ConfiguracionAdmin,
  ConfiguracionSucursalBody,
  CrearEmpleadoBody,
  CrearItemCartaBody,
  CrearSucursalBody,
  DashboardAdmin,
  DuenoSesion,
  EmpleadoAdmin,
  EmpleadosRespuesta,
  FeaturePlan,
  FirmaSubida,
  GoogleEstado,
  ItemCartaAdmin,
  ItemOverrideAdmin,
  LoginDuenoRespuesta,
  NegocioAdmin,
  PendientesRespuesta,
  QrInfo,
  ResultadoEliminarSucursal,
  SucursalAdmin,
  SucursalesRespuesta,
  UbicacionGoogle,
  UsoMensualAdmin,
} from '@/types/api';

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
  /**
   * Los 2 QRs FIJOS del negocio (`GET /negocios/qr-info`). OJO: el shape real es
   * `{ negocio, qrMenu: {url, etiqueta}, qrClub: {url, etiqueta} }`; el `{urlCliente, urlStaff}` que
   * se habia tipado en la Fase 0b era inventado (no hay endpoint de QR del staff).
   */
  qrInfo: () => api.get<QrInfo>(endpoints.negocios.qrInfo),
  /** Puede aceptar nombre/telefono desde la Fase 0; `placeId` se agrego para el boton de resena. */
  actualizar: (body: { nombre?: string; telefono?: string; placeId?: string }) =>
    api.patch<NegocioAdmin>(endpoints.negocios.update, body),
};

export const sucursalesApi = {
  /**
   * Listado del dueno (`GET /sucursales`): trae las metricas del mes y si la sucursal tiene
   * config propia. Es distinto de `mis-sucursales` (pensado para el selector de la staff).
   */
  listar: (filtros: { activa?: string; esPrincipal?: string; busqueda?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return api.get<SucursalesRespuesta>(`${endpoints.sucursales.list}${q ? `?${q}` : ''}`);
  },

  /** Alcance por rol (en el admin el dueno ve todas las activas). Da el selector de sucursal. */
  misSucursales: () =>
    api.get<{ data: SucursalAdmin[]; total: number; alcance: string }>(endpoints.sucursales.misSucursales),

  obtener: (id: string) => api.get<SucursalAdmin>(endpoints.sucursales.get(id)),

  crear: (body: CrearSucursalBody) => api.post<SucursalAdmin>(endpoints.sucursales.create, body),

  actualizar: (id: string, body: ActualizarSucursalBody) =>
    api.patch<SucursalAdmin>(endpoints.sucursales.update(id), body),

  marcarPrincipal: (id: string) => api.patch<{ ok: boolean }>(endpoints.sucursales.principal(id)),

  /**
   * `DELETE /sucursales/:id` es destructivo de verdad (a diferencia del de carta, que solo apaga):
   * reasigna los empleados a la principal y CANCELA los pedidos activos. Sin `force`, el backend
   * responde 409 si la sucursal tiene movimiento (`EliminarSucursalDto.force`).
   */
  eliminar: (id: string, force = false) =>
    api.delete<ResultadoEliminarSucursal>(
      `${endpoints.sucursales.delete(id)}${force ? '?force=true' : ''}`,
    ),
};

/**
 * Config PROPIAS de una sucursal (override del club).
 *
 * Un campo ausente NO se toca; un `null` LO BORRA (vuelve a heredar). Se escribe con POST (es un
 * upsert del backend), no con PATCH.
 */
export const sucursalConfigApi = {
  obtener: (sucursalId: string) =>
    api.get<Record<string, unknown>>(endpoints.sucursales.configuracion(sucursalId)),
  efectiva: (sucursalId: string) =>
    api.get<Record<string, unknown>>(endpoints.sucursales.configuracionEfectiva(sucursalId)),
  guardar: (sucursalId: string, body: ConfiguracionSucursalBody) =>
    api.post<Record<string, unknown>>(endpoints.sucursales.configuracion(sucursalId), body),
  /** Borra TODO el override: la sucursal vuelve a heredar del club. */
  borrar: (sucursalId: string) =>
    api.delete<{ ok: boolean }>(endpoints.sucursales.configuracion(sucursalId)),
};

/** Precio/disponibilidad propios de un item en UNA sucursal. */
export const itemsOverrideApi = {
  listar: (sucursalId: string) =>
    api.get<{ sucursalId: string; total: number; data: ItemOverrideAdmin[] }>(
      endpoints.sucursales.itemsOverride(sucursalId),
    ),
  /** `precio: null` = volver al precio global del item. */
  guardar: (
    sucursalId: string,
    body: { itemCartaId: string; precio?: number | null; disponible?: boolean | null },
  ) => api.post<Record<string, unknown>>(endpoints.sucursales.itemsOverride(sucursalId), body),
  eliminar: (sucursalId: string, itemCartaId: string) =>
    api.delete<{ ok: boolean }>(endpoints.sucursales.itemOverride(sucursalId, itemCartaId)),
};

export const empleadosApi = {
  listar: (filtros: { page?: number; pageSize?: number; sucursalId?: string; rol?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return api.get<EmpleadosRespuesta>(`${endpoints.empleados.list}${q ? `?${q}` : ''}`);
  },

  obtener: (id: string) => api.get<EmpleadoAdmin>(endpoints.empleados.get(id)),

  /** `pin` de 4 a 8 digitos. SIN pin el empleado queda creado pero NO puede entrar. */
  crear: (body: CrearEmpleadoBody) => api.post<EmpleadoAdmin>(endpoints.empleados.create, body),

  actualizar: (id: string, body: ActualizarEmpleadoBody) =>
    api.patch<EmpleadoAdmin>(endpoints.empleados.update(id), body),

  /** 409 si el PIN ya lo usa otro empleado del mismo negocio (`exigirPinLibre`). */
  resetPin: (id: string, pin: string) =>
    api.patch<{ ok: boolean }>(endpoints.empleados.resetPin(id), { pin }),

  /** Soft delete: `activo:false` + `eliminadoEn`, y borra las sesiones del empleado. */
  desactivar: (id: string) =>
    api.delete<{ id: string; nombre: string; activo: boolean }>(endpoints.empleados.delete(id)),
};

export const cartaApi = {
  /** Ya viene agrupado por categoria: `{ total, categorias: [{ categoria, items }] }`. */
  admin: (filtros: { categoria?: string; search?: string; disponible?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    return api.get<CartaAdminRespuesta>(`${endpoints.carta.admin}${q ? `?${q}` : ''}`);
  },

  /**
   * Prende/apaga un item del NEGOCIO (no hay override por sucursal en este endpoint): lo que se
   * apaga aca desaparece de la carta de TODAS las sucursales.
   */
  disponibilidad: (id: string, disponible: boolean) =>
    api.patch<Pick<ItemCartaAdmin, 'id' | 'disponible'>>(endpoints.carta.disponibilidad(id), {
      disponible,
    }),

  actualizar: (id: string, body: ActualizarItemCartaBody) =>
    api.patch<ItemCartaAdmin>(endpoints.carta.update(id), body),

  crear: (body: CrearItemCartaBody) => api.post<ItemCartaAdmin>(endpoints.carta.create, body),

  eliminar: (id: string) => api.delete<{ ok: boolean }>(endpoints.carta.delete(id)),

  /** Batch: el backend actualiza el orden de todos los items en una sola transaccion. */
  reordenar: (items: { id: string; orden: number }[]) =>
    api.post<{ ok: boolean }>(endpoints.carta.reordenar, { items }),
};

export const configuracionApi = {
  /** La fila cruda de `ConfiguracionClub` (una por negocio, con los defaults aplicados). */
  obtener: () => api.get<ConfiguracionAdmin>(endpoints.configuracion.get),
  efectiva: () => api.get<ConfiguracionAdmin>(endpoints.configuracion.efectiva),
  actualizar: (body: ActualizarConfiguracionBody) =>
    api.patch<ConfiguracionAdmin>(endpoints.configuracion.update, body),
};

/**
 * Google Business Profile.
 *
 * Todo esto esta detras de `@RequiereFeature('google_business')` en el backend: si el plan no la
 * incluye, responde 403 y la pantalla lo muestra tal cual.
 */
export const googleApi = {
  estado: () => api.get<GoogleEstado>(endpoints.google.estado),
  /** Devuelve `{ url }` con la URL de consentimiento: la pantalla REDIRIGE ahi. */
  conectar: () => api.get<{ url?: string }>(endpoints.google.conectar),
  /** El OAuth no devuelve accountId/locationId: hay que listarlos y elegir uno. */
  ubicaciones: () => api.get<{ total: number; data: UbicacionGoogle[] }>(endpoints.google.ubicaciones),
  seleccionar: (body: {
    accountId: string
    locationId: string
    accountName?: string | undefined
    locationName?: string | undefined
  }) => api.post<{ ok: boolean }>(endpoints.google.ubicacion, body),
  desconectar: () => api.delete<{ ok: boolean }>(endpoints.google.desconectar),
};

export const planesApi = {
  miPlan: () => api.get<Record<string, unknown>>(endpoints.planes.miPlan),
  usoMensual: () => api.get<Record<string, unknown>>(endpoints.planes.usoMensual),
  usoMensualHistorico: () => api.get<Record<string, unknown>>(endpoints.planes.usoMensualHistorico),
  features: () => api.get<FeaturePlan[]>(endpoints.planes.features),
};

export const estadisticasApi = {
  /** Cacheado en Redis del lado del backend: `cacheado: true` cuando lo sirvio la cache. */
  dashboard: () => api.get<DashboardAdmin>(endpoints.estadisticas.dashboard),
  topClientes: () => api.get<{ data: unknown[] }>(endpoints.estadisticas.topClientes),
};

export const usoApi = {
  /** Uso del periodo (actual o el que se pida) con el limite de cada recurso. */
  usoMensual: (periodo?: string) =>
    api.get<UsoMensualAdmin>(
      `${endpoints.planes.usoMensual}${periodo ? `?periodo=${encodeURIComponent(periodo)}` : ''}`,
    ),
  miPlan: () => api.get<Record<string, unknown>>(endpoints.planes.miPlan),
};

export const visitasApi = {
  /**
   * La cola de solicitudes VIVAS (`usado: false` + sin vencer). No es lo mismo que
   * `mis-aprobaciones`, que devuelve lo que el empleado ya aprobo hoy.
   */
  pendientes: () => api.get<PendientesRespuesta>(endpoints.visitas.pendientes),
};

export const mediaApi = {
  /**
   * Pide la FIRMA al backend: el binario NO pasa por aca. El multipart va del navegador directo a
   * `https://api.cloudinary.com/v1_1/<cloudName>/image/upload` (lo arma `SubirImagen`).
   */
  firmarSubida: (body: { tipo?: 'carta' } = {}) =>
    api.post<FirmaSubida>(endpoints.media.firmarSubida, body),
};
