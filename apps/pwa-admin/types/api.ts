/**
 * Tipos de la PWA Admin.
 *
 * Se agregan a medida que cada fase los necesita (mismo criterio que la PWA Staff): no se
 * declara la forma de un endpoint antes de consumirlo, porque el tipo inventado se convierte en
 * una mentira que el compilador avala.
 */

/** Lo que devuelve `GET /negocios/mi-negocio` (el endpoint de DUENO que existe hoy). */
export interface NegocioAdmin {
  id: string
  nombre: string
  slug: string
  plan: string
  /** Mapa `feature -> { habilitada, limite }`: lo arma el backend para que el panel sepa que mostrar. */
  features?: Record<string, { habilitada: boolean; limite: number | null }>
  sucursalesActivas?: number
  /** Configuracion del negocio (`menuActivo`, etc): viene del shape publico que arma `publicoPorSlug`. */
  configuracion?: Record<string, unknown> | undefined
}

/**
 * Sesion del dueno.
 *
 * `dueno` sale del token (o de `/auth/dueno/me` cuando exista, Fase 0c) y `negocio` de
 * `mi-negocio`: mientras `me` no exista, el sondeo de sesion usa ese endpoint.
 */
export interface DuenoSesion {
  dueno: { id: string; nombre: string; email: string }
  negocio: NegocioAdmin
}

/**
 * Respuesta de `POST /auth/dueno/login`.
 *
 * Es deliberadamente laxa: si el 2FA esta prendido llega `{ requiere2FA: true, challengeToken }`
 * y NADA mas; si no, la sesion. La Fase 1 la ajusta contra la respuesta real (hoy no hay
 * ninguna pantalla que la consuma, y un tipo cerrado inventado seria peor que uno abierto).
 */
export interface LoginDuenoRespuesta {
  requiere2FA?: boolean
  challengeToken?: string
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
}

/** Un feature del plan, como lo devuelve `GET /negocios/features`. */
export interface FeaturePlan {
  feature: string
  habilitada: boolean
  limite: number | null
}

/** Item de carta tal como lo devuelve `GET /carta/admin` (precios ya como number, no Decimal). */
export interface ItemCartaAdmin {
  id: string
  categoria: string
  nombre: string
  descripcion: string | null
  precio: number
  fotoUrl: string | null
  etiquetas: string[]
  disponible: boolean
  orden: number
  /** Precio propio por sucursal: `null` = usa el del negocio. */
  overridesSucursal?: {
    sucursalId: string
    precio: number | null
    sucursal?: { id: string; nombre: string; slug: string }
  }[]
}

export interface GrupoCarta {
  categoria: string
  items: ItemCartaAdmin[]
}

/** `GET /carta/admin` devuelve los items YA agrupados por categoria. */
export interface CartaAdminRespuesta {
  total: number
  categorias: GrupoCarta[]
}

/** Campos de `POST /carta` (el de `PATCH /carta/:id` es el mismo, todo opcional). */
export interface CrearItemCartaBody {
  categoria: string
  nombre: string
  // Los opcionales van `?: T | undefined`: con `exactOptionalPropertyTypes` (tsconfig del repo),
  // un campo declarado `?: T` NO acepta que le pases `undefined` explicito (regla de la casa).
  descripcion?: string | undefined
  precio: number
  /** OJO: el backend lo llama `fotoUrl` (no `imagenUrl`). */
  fotoUrl?: string | undefined
  etiquetas?: string[] | undefined
  disponible?: boolean | undefined
  orden?: number | undefined
}

export type ActualizarItemCartaBody = Partial<CrearItemCartaBody>
