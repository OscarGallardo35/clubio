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

// ---------------------------------------------------------------- Fase 4: Personal + Sucursales --

/** Los literales son los del enum de Prisma (no los del pedido: es `MESERO`, no `MOZO`). */
export type RolEmpleado = 'DUENO' | 'ENCARGADO' | 'CAJERO' | 'MESERO' | 'DELIVERY' | 'EMPLEADO'

/**
 * Empleado como lo devuelve `GET /empleados` (el `SELECT_PUBLICO` del backend + su sucursal).
 * Nunca trae el PIN: solo se ve UNA vez, cuando el dueno lo escribe o lo genera.
 */
export interface EmpleadoAdmin {
  id: string
  negocioId: string
  sucursalId: string
  nombre: string
  rol: RolEmpleado
  email: string | null
  telefono: string | null
  avatarUrl: string | null
  twoFactorEnabled: boolean
  accesoMultiSucursal: boolean
  activo: boolean
  /** ISO o null si nunca entro. */
  ultimoAcceso: string | null
  creadoEn: string
  sucursal?: { id: string; nombre: string; slug: string }
}

export interface EmpleadosRespuesta {
  data: EmpleadoAdmin[]
  total: number
  page: number
  pageSize: number
}

export interface CrearEmpleadoBody {
  nombre: string
  rol: RolEmpleado
  sucursalId: string
  /** 4 a 8 digitos. SIN pin el empleado queda creado pero NO puede entrar. */
  pin?: string | undefined
  email?: string | undefined
  telefono?: string | undefined
  accesoMultiSucursal?: boolean | undefined
}

export interface ActualizarEmpleadoBody {
  nombre?: string | undefined
  rol?: RolEmpleado | undefined
  sucursalId?: string | undefined
  email?: string | undefined
  telefono?: string | undefined
  accesoMultiSucursal?: boolean | undefined
  activo?: boolean | undefined
}

/** Sucursal del listado del dueno (`GET /sucursales`): trae las metricas del mes resueltas. */
export interface SucursalAdmin {
  id: string
  nombre: string
  slug: string
  direccion: string | null
  telefono: string | null
  numeroAtendiente: string | null
  activa: boolean
  esPrincipal: boolean
  colorPrimario: string | null
  colorSecundario: string | null
  creadoEn: string
  empleadosActivos: number
  clientesRegistrados: number
  pedidosDelMes: number
  visitasDelMes: number
  /** true si la sucursal tiene config propia (override); `false` = hereda todo del club. */
  tieneConfiguracionOverride: boolean
}

export interface SucursalesRespuesta {
  data: SucursalAdmin[]
  total: number
}

export interface CrearSucursalBody {
  nombre: string
  /** Solo minusculas, numeros y guiones. Va en la URL del cliente y NO se cambia despues. */
  slug: string
  direccion?: string | undefined
  telefono?: string | undefined
  numeroAtendiente?: string | undefined
  colorPrimario?: string | undefined
  colorSecundario?: string | undefined
  /** La primera sucursal del negocio se fuerza principal; si ya hay una, se ignora. */
  esPrincipal?: boolean | undefined
}

export interface ActualizarSucursalBody {
  nombre?: string | undefined
  direccion?: string | undefined
  telefono?: string | undefined
  numeroAtendiente?: string | undefined
  colorPrimario?: string | undefined
  colorSecundario?: string | undefined
  /** Es lo que hace el DELETE del admin: `activa: false` (Sucursal NO tiene soft delete con fecha). */
  activa?: boolean | undefined
}

export interface ResultadoEliminarSucursal {
  ok: boolean
  sucursalId: string
  empleadosReasignados?: number
  pedidosCancelados?: number
}

/**
 * Override de config de una sucursal: un campo `null` (o ausente) HEREDA el valor del club.
 * Son los campos de `CAMPOS_OVERRIDE` del backend; los arrays (`tiposPedidoHabilitados`,
 * `modosPagoHabilitados`) quedan fuera de esta pantalla a proposito (un `[]` significa heredar,
 * no "ninguno", y eso no se puede expresar con un input vacio sin mentir).
 */
export interface ConfiguracionSucursalBody {
  premioTexto?: string | null
  sellosParaPremio?: number | null
  sellosBienvenida?: number | null
  limiteVisitasPorDia?: number | null
  horasMinimasEntreVisitas?: number | null
  costoEnvio?: number | null
  pedidoMinimoDelivery?: number | null
  zonaEntrega?: string | null
  transferenciaAlias?: string | null
  transferenciaCbu?: string | null
  transferenciaTitular?: string | null
  transferenciaBanco?: string | null
}

/** Override de precio/disponibilidad de un item en una sucursal (precios ya como number). */
export interface ItemOverrideAdmin {
  id: string
  itemCartaId: string
  itemNombre: string
  categoria: string
  precioGlobal: number
  disponibleGlobal: boolean
  precioOverride: number | null
  disponibleOverride: boolean | null
}
