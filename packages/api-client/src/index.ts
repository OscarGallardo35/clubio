import { io, Socket } from 'socket.io-client'

/**
 * Tipos de eventos WS. Viven en `@repo/types` (paquete puro) y se re-exportan aca
 * para que las PWAs los importen junto al resto del cliente. NO se declaran en este
 * paquete porque el backend tambien los necesita y `@repo/api-client` arrastra
 * `socket.io-client` al build de Nest.
 */
export type { VisitaAprobadaPayload } from '@repo/types'

/**
 * Cliente HTTP tipado + factory de sockets, compartido por las 3 PWAs.
 *
 * Notas de integracion con el backend real:
 * - `credentials: 'include'` es obligatorio: la PWA Cliente se autentica con una
 *   cookie HttpOnly (`cliente_token`), no con localStorage.
 * - El header `X-Tenant-Slug` viaja en TODAS las requests (el TenantGuard lo
 *   valida contra el negocio del token: si no coinciden, responde 403).
 * - El WebSocket espera el token en `auth.token` (o `?token=`), NO en
 *   `auth.Authorization`: el gateway lee `handshake.auth.token`.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public data?: any,
    message?: string
  ) {
    super(message || `API Error: ${status}`)
    this.name = 'ApiError'
  }
}

export interface ApiClientConfig {
  baseUrl: string
  getToken?: () => string | null
  getTenant?: () => string | null
  onUnauthorized?: () => void
}

export class ApiClient {
  private baseUrl: string
  private token: string | null = null
  private tenant: string | null = null
  // Union explicita (no `?`): el tsconfig compartido usa
  // exactOptionalPropertyTypes, y con eso `campo?: F` NO acepta `undefined`.
  private getTokenFn: (() => string | null) | undefined
  private getTenantFn: (() => string | null) | undefined
  private onUnauthorized: (() => void) | undefined

  constructor(config: ApiClientConfig) {
    // Se quita la barra final para no generar rutas con doble slash.
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.getTokenFn = config.getToken
    this.getTenantFn = config.getTenant
    this.onUnauthorized = config.onUnauthorized
    this.token = config.getToken?.() ?? null
    this.tenant = config.getTenant?.() ?? null
  }

  /** Guarda el token en memoria (la PWA Cliente no lo necesita: usa la cookie). */
  setToken(token: string | null): void {
    this.token = token
  }

  /** Fija el tenant activo (slug del negocio que se esta visitando). */
  setTenant(tenant: string | null): void {
    this.tenant = tenant
  }

  getTenant(): string | null {
    return this.getTenantFn?.() ?? this.tenant
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const token = this.getTokenFn?.() ?? this.token
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const tenant = this.getTenant()
    if (tenant) {
      headers['X-Tenant-Slug'] = tenant
    }

    const init: RequestInit = {
      method,
      headers,
      // Cookie HttpOnly de la PWA Cliente.
      credentials: 'include',
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    const response = await fetch(url, init)

    if (response.status === 401) {
      this.onUnauthorized?.()
      throw new ApiError(401, undefined, 'No autorizado')
    }

    const texto = await response.text()
    let data: any = undefined
    if (texto) {
      try {
        data = JSON.parse(texto)
      } catch {
        data = texto
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, data, data?.message || 'Error en la solicitud')
    }

    return data as T
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async patch<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  async put<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  async delete<T>(path: string, body?: any): Promise<T> {
    return this.request<T>('DELETE', path, body)
  }
}

export interface SocketConfig {
  url: string
  token?: string | null
  namespace?: string
  onConnect?: () => void
  onDisconnect?: () => void
}

/**
 * Crea un socket. El token va en `auth.token` porque es lo que lee el gateway
 * del backend (`handshake.auth.token`); tambien acepta la cookie HttpOnly si no
 * se pasa token (withCredentials: true).
 */
export function createSocket(config: SocketConfig): Socket {
  const socket = io(`${config.url}${config.namespace ?? ''}`, {
    // Se arma con spread condicional: `auth: undefined` no compila con
    // exactOptionalPropertyTypes.
    ...(config.token ? { auth: { token: config.token } } : {}),
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  })

  if (config.onConnect) socket.on('connect', config.onConnect)
  if (config.onDisconnect) socket.on('disconnect', config.onDisconnect)

  return socket
}

/** Atajo para no instanciar el cliente a mano en cada PWA. */
export function useApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config)
}

/**
 * Rutas del backend (prefijo global /api).
 * Los `:param` se interpolan con los helpers.
 */
export const endpoints = {
  auth: {
    registrarCliente: '/api/auth/cliente/registrar',
    recuperarCliente: '/api/auth/cliente/recuperar',
    meCliente: '/api/auth/cliente/me',
    logoutCliente: '/api/auth/cliente/logout',
    loginEmpleado: '/api/auth/empleado/login',
    logoutEmpleado: '/api/auth/empleado/logout',
    meEmpleado: '/api/auth/empleado/me',
    loginDueno: '/api/auth/dueno/login',
    verificar2FA: '/api/auth/dueno/verificar-2fa',
    refreshDueno: '/api/auth/dueno/refresh',
    logoutDueno: '/api/auth/dueno/logout',
    meDueno: '/api/auth/dueno/me',
  },
  negocios: {
    publico: (slug: string) => `/api/negocios/publico/${slug}`,
    miNegocio: '/api/negocios/mi-negocio',
    features: '/api/negocios/features',
    qrInfo: '/api/negocios/qr-info',
    update: '/api/negocios',
  },
  sucursales: {
    publico: '/api/sucursales/publico',
    list: '/api/sucursales',
    misSucursales: '/api/sucursales/mis-sucursales',
    get: (id: string) => `/api/sucursales/${id}`,
    create: '/api/sucursales',
    update: (id: string) => `/api/sucursales/${id}`,
    principal: (id: string) => `/api/sucursales/${id}/principal`,
    delete: (id: string) => `/api/sucursales/${id}`,
    /** Config propia de la sucursal: override crudo (con nulls), un POST por cambio. */
    configuracion: (id: string) => `/api/sucursales/${id}/configuracion`,
    configuracionEfectiva: (id: string) => `/api/sucursales/${id}/configuracion/efectiva`,
    /** Los campos que una sucursal PUEDE overridear (lo dice el backend, no nosotros). */
    configuracionCampos: (id: string) => `/api/sucursales/${id}/configuracion/campos`,
    /** Precio/disponibilidad propios de esta sucursal para un item de carta. */
    itemsOverride: (id: string) => `/api/sucursales/${id}/items-override`,
    itemOverride: (id: string, itemCartaId: string) => `/api/sucursales/${id}/items-override/${itemCartaId}`,
  },
  empleados: {
    list: '/api/empleados',
    get: (id: string) => `/api/empleados/${id}`,
    create: '/api/empleados',
    update: (id: string) => `/api/empleados/${id}`,
    resetPin: (id: string) => `/api/empleados/${id}/reset-pin`,
    delete: (id: string) => `/api/empleados/${id}`,
  },
  configuracion: {
    get: '/api/configuracion',
    efectiva: '/api/configuracion/efectiva',
    update: '/api/configuracion',
  },
  google: {
    /** Estado de la integracion (sin tokens). */
    estado: '/api/google/estado',
    /** Devuelve la URL de consentimiento: el admin redirige ahi. */
    conectar: '/api/google/conectar',
    ubicaciones: '/api/google/ubicaciones',
    ubicacion: '/api/google/ubicacion',
    desconectar: '/api/google/desconectar',
  },
  planes: {
    miPlan: '/api/planes/mi-plan',
    usoMensual: '/api/planes/uso-mensual',
    usoMensualHistorico: '/api/planes/uso-mensual/historico',
    features: '/api/planes/features',
  },
  estadisticas: {
    dashboard: '/api/estadisticas/dashboard',
    topClientes: '/api/estadisticas/top-clientes',
  },
  visitas: {
    solicitar: '/api/visitas/solicitar',
    estado: (token: string) => `/api/visitas/estado/${token}`,
    validar: (token: string) => `/api/visitas/validar/${token}`,
    aprobar: (token: string) => `/api/visitas/aprobar/${token}`,
    rechazar: (token: string) => `/api/visitas/rechazar/${token}`,
    /** Canjea un premio ya desbloqueado: `{ clienteId, tipo: SELLOS | PUNTOS }`. */
    canjear: '/api/visitas/canjear',
    miTarjeta: '/api/visitas/mi-tarjeta',
    miHistorial: '/api/visitas/mi-historial',
    pendientes: '/api/visitas/pendientes',
    misAprobaciones: '/api/visitas/mis-aprobaciones',
    historial: '/api/visitas/historial',
    /** Fase 2: corrige el monto de una visita ya aprobada (recalcula los puntos). */
    editarMonto: (id: string) => `/api/visitas/${id}/monto`,
  },
  carta: {
    list: '/api/carta',
    admin: '/api/carta/admin',
    create: '/api/carta',
    update: (id: string) => `/api/carta/${id}`,
    disponibilidad: (id: string) => `/api/carta/${id}/disponibilidad`,
    delete: (id: string) => `/api/carta/${id}`,
    reordenar: '/api/carta/reordenar',
  },
  modificadores: {
    gruposDeItem: (itemId: string) => `/api/modificadores/items/${itemId}/grupos`,
  },
  pedidos: {
    crear: '/api/pedidos',
    publico: (linkToken: string) => `/api/pedidos/publico/${linkToken}`,
    /** De STAFF: resuelve por linkToken usando el negocio del token (sin `X-Tenant-Slug`). */
    porLink: (linkToken: string) => `/api/pedidos/por-link/${linkToken}`,
    /** Cancela con SOLO el linkToken (la puerta de los guest del QR #1). */
    cancelar: (linkToken: string) => `/api/pedidos/publico/${linkToken}/cancelar`,
    get: (id: string) => `/api/pedidos/${id}`,
    list: '/api/pedidos',
    estado: (id: string) => `/api/pedidos/${id}/estado`,
    tomar: (id: string) => `/api/pedidos/${id}/tomar`,
    historial: '/api/pedidos/historial',
    estadisticas: '/api/pedidos/estadisticas',
  },
  upsell: {
    calcular: '/api/upsell/calcular',
  },
  resenas: {
    publicas: '/api/resenas',
  },
  push: {
    vapidPublicKey: '/api/push/vapid-public-key',
    suscribir: '/api/push/suscribir',
  },
  media: {
    /**
     * Firma una subida DIRECTA a Cloudinary: el backend devuelve timestamp/signature/apiKey/
     * cloudName/folder/transformation y el NAVEGADOR manda el binario a Cloudinary. El backend
     * nunca recibe el archivo.
     */
    firmarSubida: '/api/media/firmar-subida',
  },
  health: '/api/health',
} as const
