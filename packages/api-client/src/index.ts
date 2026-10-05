import { io, Socket } from 'socket.io-client'
import type * as Types from '@repo/types'

// Clase personalizada para errores de API
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

// Configuración del cliente
export interface ApiClientConfig {
  baseUrl: string
  getToken?: () => string | null
  getTenant?: () => string | null
  onUnauthorized?: () => void
}

// Cliente HTTP tipado
export class ApiClient {
  private baseUrl: string
  private getToken?: () => string | null
  private getTenant?: () => string | null
  private onUnauthorized?: () => void

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl
    this.getToken = config.getToken
    this.getTenant = config.getTenant
    this.onUnauthorized = config.onUnauthorized
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: any
  ): Promise<T> {
    const url = \`\${this.baseUrl}\${path}\`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Agregar token de autenticación
    const token = this.getToken?.()
    if (token) {
      headers['Authorization'] = \`Bearer \${token}\`
    }

    // Agregar tenant slug
    const tenant = this.getTenant?.()
    if (tenant) {
      headers['X-Tenant-Slug'] = tenant
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })

    // Manejar 401 Unauthorized
    if (response.status === 401) {
      this.onUnauthorized?.()
      throw new ApiError(401, undefined, 'No autorizado')
    }

    // Parsear respuesta
    const data = await response.json()

    if (!response.ok) {
      throw new ApiError(response.status, data, data.message || 'Error en la solicitud')
    }

    return data as T
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body: any): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async patch<T>(path: string, body: any): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

// Configuración de Socket.io
export interface SocketConfig {
  url: string
  token?: string
  namespace?: string
  onConnect?: () => void
  onDisconnect?: () => void
}

// Factory para crear socket
export function createSocket(config: SocketConfig): Socket {
  return io(config.url, {
    namespace: config.namespace || '/',
    auth: config.token
      ? {
          Authorization: \`Bearer \${config.token}\`,
        }
      : undefined,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  })
}

// Hook para usar en React (si se necesita)
export function useApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config)
}

// Endpoints helpers (optional, para tipado fuerte)
export const endpoints = {
  // Auth
  auth: {
    loginEmpleado: '/api/auth/empleado/login',
    loginDueno: '/api/auth/dueno/login',
    verify2FA: '/api/auth/verify-2fa',
    refresh: '/api/auth/refresh',
    logout: '/api/auth/logout',
  },
  // Clientes
  clientes: {
    list: '/api/clientes',
    get: (id: string) => \`/api/clientes/\${id}\`,
    create: '/api/clientes',
    update: (id: string) => \`/api/clientes/\${id}\`,
    verificar: '/api/clientes/verificar',
    registrar: '/api/clientes/registrar',
  },
  // Visitas
  visitas: {
    list: '/api/visitas',
    solicitar: '/api/visitas/solicitar',
    aprobar: '/api/visitas/aprobar',
    rechazar: '/api/visitas/rechazar',
    regalo: '/api/visitas/regalo',
  },
  // Carta
  carta: {
    list: '/api/carta',
    create: '/api/carta',
    update: (id: string) => \`/api/carta/\${id}\`,
    delete: (id: string) => \`/api/carta/\${id}\`,
    reordenar: '/api/carta/reordenar',
  },
  // Health
  health: '/api/health',
} as const
