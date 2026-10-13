import { ApiClient, endpoints } from '@repo/api-client';
import type {
  ActualizarPlanNegocioBody,
  DatosLocalBody,
  EmpleadoBody,
  EmpleadoLocal,
  EstadoPlanNegocio,
  FeatureCatalogo,
  ItemCartaBody,
  ItemCartaLocal,
  LocalesRespuesta,
  LoginSuperAdminRespuesta,
  PlantillaDemo,
  ResultadoProvision,
  ResultadoResetDemo,
  ResumenPlataforma,
  SuperAdminSesion,
} from '@/types/api';
import type { TenantTheme } from '@repo/types';
import type { FirmaSubidaMedia } from '@repo/ui';

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

  /* --- detalle de un local ------------------------------------------------ */

  /** Detalle de UN local: sus datos, su config, su theme y sus contadores. */
  detalle: (negocioId: string) => api.get<unknown>(endpoints.superadmin.local(negocioId)),

  /**
   * Crea el local (el backend crea tambien su sucursal principal).
   *
   * Devuelve `unknown` y no `LocalDetalle` a proposito: la respuesta la tiene que pasar
   * por `desenvolverLocal()`, que ademas de normalizar es la unica defensa contra un body
   * envuelto (`{ local }`, `{ data }`). El wizard necesita el `id`/`slug` REALES para
   * encadenar la provision: equivocarse de nivel significa provisionar `undefined`.
   */
  crearLocal: (body: DatosLocalBody) => api.post<unknown>(endpoints.superadmin.locales, body),

  /** Edita datos base / activa-desactiva / cambia el plan. */
  actualizarLocal: (negocioId: string, body: DatosLocalBody) =>
    api.patch<unknown>(endpoints.superadmin.local(negocioId), body),

  /**
   * Baja TOTAL del local (cascade en el backend): sucursales, empleados, carta, clientes,
   * visitas y pedidos. Es IRREVERSIBLE; la UI lo confirma tipeando el slug.
   */
  eliminarLocal: (negocioId: string) =>
    api.delete<{ ok?: boolean; borrados?: unknown; [k: string]: unknown }>(
      endpoints.superadmin.local(negocioId),
    ),

  /* --- plan y features del local ------------------------------------------ */

  /** Catalogo de features de la plataforma, con los planes que incluyen cada una. */
  features: () => api.get<FeatureCatalogo[]>(endpoints.superadmin.features),

  /** Plan + features + pay-per-use de UN local. */
  planLocal: (negocioId: string) =>
    api.get<EstadoPlanNegocio>(endpoints.superadmin.localPlan(negocioId)),

  /** Cambia el plan y/o las features y/o el pay-per-use. Devuelve el estado real resultante. */
  actualizarPlan: (negocioId: string, body: ActualizarPlanNegocioBody) =>
    api.patch<EstadoPlanNegocio>(endpoints.superadmin.localPlan(negocioId), body),

  /**
   * Firma una subida directa a Cloudinary con la sesion de PLATAFORMA (nunca envia el binario).
   *
   * El `negocioId` es OBLIGATORIO y va en el body: el super-admin no tiene tenant (el panel
   * administra varios locales) y el backend firma SIEMPRE para el local que se le pasa.
   */
  firmarSubida: (body: { negocioId: string; tipo?: string }) =>
    api.post<FirmaSubidaMedia>(endpoints.superadmin.mediaFirmarSubida, body),

  /**
   * Campos del club (modo de fidelizacion, sellos, premio, WhatsApp).
   *
   * Se mandan SOLO los campos del formulario: el backend valida con el `ActualizarConfiguracionDto`
   * del dueno y `forbidNonWhitelisted`, asi que una clave de mas es un 400 que rompe el guardado.
   *
   * Un campo con `null` EXPLICITO BORRA el valor guardado (ej. borrar el WhatsApp). El string
   * vacio NO borra: el backend lo ignora (significa "no tocar").
   */
  actualizarConfiguracion: (negocioId: string, body: Record<string, unknown>) =>
    api.patch<unknown>(endpoints.superadmin.configuracion(negocioId), body),

  /**
   * Theme de la tarjeta del cliente.
   *
   * El body va DIRECTO (el objeto `TenantTheme`), no envuelto en `{ theme }`: el endpoint es
   * `PATCH .../theme` y el backend hace MERGE superficial sobre el theme existente.
   */
  actualizarTheme: (negocioId: string, theme: TenantTheme) =>
    api.patch<unknown>(endpoints.superadmin.theme(negocioId), theme),

  /* --- la fabrica --------------------------------------------------------- */

  /**
   * Deja el local LISTO para la demo (config + theme + carta + empleados + cliente). Idempotente.
   *
   * `reemplazarCarta` (default false) borra los items que NO sean de la plantilla; apagado, los
   * items de la plantilla se SUMAN a la carta actual. `forzarTheme` (default false) pisa el theme
   * del local; apagado, si el local ya tiene personalizacion visual, se respeta.
   */
  provisionar: (
    negocioId: string,
    body: {
      plantilla: PlantillaDemo;
      config?: Record<string, unknown>;
      theme?: TenantTheme;
      reemplazarCarta?: boolean;
      forzarTheme?: boolean;
    },
  ) => api.post<unknown>(endpoints.superadmin.provisionar(negocioId), body),

  /** Vuelve el local a su estado de demo sin tocar branding ni config. */
  resetDemo: (negocioId: string) => api.post<unknown>(endpoints.superadmin.resetDemo(negocioId), {}),

  /* --- carta -------------------------------------------------------------- */

  /** La respuesta es `{ negocioId, total, items, categorias }`: la resuelve `itemsDeCarta`. */
  carta: (negocioId: string) => api.get<unknown>(endpoints.superadmin.carta(negocioId)),

  crearItem: (negocioId: string, body: ItemCartaBody) =>
    api.post<ItemCartaLocal>(endpoints.superadmin.cartaItems(negocioId), body),

  actualizarItem: (negocioId: string, itemId: string, body: Partial<ItemCartaBody>) =>
    api.patch<ItemCartaLocal>(endpoints.superadmin.cartaItem(negocioId, itemId), body),

  /** Baja logica: el item queda NO disponible (la carta de admin los muestra igual). */
  eliminarItem: (negocioId: string, itemId: string) =>
    api.delete<{ ok?: boolean }>(endpoints.superadmin.cartaItem(negocioId, itemId)),

  /* --- empleados ---------------------------------------------------------- */

  /** La respuesta es `{ total, data }` con `tienePin`/`tienePassword` y sin hashes. */
  empleados: (negocioId: string) => api.get<unknown>(endpoints.superadmin.empleados(negocioId)),

  crearEmpleado: (negocioId: string, body: EmpleadoBody) =>
    api.post<EmpleadoLocal>(endpoints.superadmin.empleados(negocioId), body),

  actualizarEmpleado: (negocioId: string, empleadoId: string, body: Partial<EmpleadoBody>) =>
    api.patch<EmpleadoLocal>(endpoints.superadmin.empleado(negocioId, empleadoId), body),

  eliminarEmpleado: (negocioId: string, empleadoId: string) =>
    api.delete<{ ok?: boolean }>(endpoints.superadmin.empleado(negocioId, empleadoId)),
};

/** Re-export de los tipos de respuesta que devuelven las mutaciones (por comodidad del caller). */
export type { ResultadoProvision, ResultadoResetDemo };
