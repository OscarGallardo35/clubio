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
  /** Place ID de la ficha de Google: alimenta el boton "Dejá tu reseña" del cliente (sin API). */
  placeId?: string | null
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

// ----------------------------------------------------------------- Fase 5: Config + QR + Google --

/** Literales del enum de Prisma `ModoFidelizacion`. */
export type ModoFidelizacion = 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO'
/** Literales del enum de Prisma `TipoPedido`. */
export type TipoPedido = 'MESA' | 'TAKEAWAY' | 'DELIVERY'
/** Literales del enum de Prisma `ModoPago`. */
export type ModoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'
/** Literales del enum de Prisma `ModoAsignacionPedidos`. */
export type ModoAsignacionPedidos = 'BROADCAST' | 'POR_ROL' | 'SOLO_ENCARGADO'

/**
 * `GET /configuracion` = la fila de `ConfiguracionClub` tal cual (una por negocio, con defaults).
 *
 * Los `Decimal` de Prisma llegan como **STRING** al JSON (`puntosPorPeso`, `costoEnvio`,
 * `pedidoMinimoDelivery`): esas cuentas no se hacen en el front sin convertir.
 */
export interface ConfiguracionAdmin {
  id: string
  negocioId: string
  modoFidelizacion: ModoFidelizacion
  sellosParaPremio: number
  premioTexto: string
  sellosBienvenida: number
  limiteVisitasPorDia: number
  horasMinimasEntreVisitas: number
  puntosPorPeso: string | null
  premioPorPuntos: number | null
  /** Tasa del programa de puntos: puntos por cada $1000. */
  puntosPorMil: number | null
  /** Texto del premio de puntos (el de sellos es `premioTexto`). */
  premioTextoPuntos: string | null
  requiereValidacionEmpleado: boolean
  permiteRegaloManual: boolean
  mensajeBienvenida: string | null
  mostrarResenaPostVisita: boolean
  permitirOverrideSucursal: boolean
  menuActivo: boolean
  tiposPedidoHabilitados: TipoPedido[]
  modosPagoHabilitados: ModoPago[]
  costoEnvio: string | null
  pedidoMinimoDelivery: string | null
  zonaEntrega: string | null
  modoPagoPorDefecto: ModoPago
  tipoPedidoPorDefecto: TipoPedido
  numeroAtendiente: string | null
  modoAsignacionPedidos: ModoAsignacionPedidos
  transferenciaAlias: string | null
  transferenciaCbu: string | null
  transferenciaTitular: string | null
  transferenciaBanco: string | null
  transferenciaNotas: string | null
  linkMercadoPago: string | null
  upsellActivo: boolean
  upsellMaxSugerencias: number
  turnosActivos: boolean
  checkinObligatorio: boolean
  pushInactividad3Dias: boolean
  pushCumpleanos: boolean
  pushPremioPorVencer: boolean
  pushAUnoDelPremio: boolean
  pushInactivos30Dias: boolean
}

/** Campos que acepta `PATCH /configuracion` (subconjunto del DTO; los Decimal van como number). */
export interface ActualizarConfiguracionBody {
  modoFidelizacion?: ModoFidelizacion | undefined
  sellosParaPremio?: number | undefined
  premioTexto?: string | undefined
  sellosBienvenida?: number | undefined
  limiteVisitasPorDia?: number | undefined
  horasMinimasEntreVisitas?: number | undefined
  requiereValidacionEmpleado?: boolean | undefined
  permiteRegaloManual?: boolean | undefined
  mostrarResenaPostVisita?: boolean | undefined
  menuActivo?: boolean | undefined
  /** Estaba en el modelo pero no en el DTO: se agrego al backend y ahora la pantalla lo guarda. */
  mensajeBienvenida?: string | undefined
  /** Programa por PUNTOS: tasa (puntos por cada $1000) y umbral/texto de su premio. */
  puntosPorMil?: number | undefined
  premioPorPuntos?: number | undefined
  premioTextoPuntos?: string | undefined
  tiposPedidoHabilitados?: TipoPedido[] | undefined
  modosPagoHabilitados?: ModoPago[] | undefined
  modoPagoPorDefecto?: ModoPago | undefined
  tipoPedidoPorDefecto?: TipoPedido | undefined
  modoAsignacionPedidos?: ModoAsignacionPedidos | undefined
  numeroAtendiente?: string | undefined
  transferenciaAlias?: string | undefined
  transferenciaCbu?: string | undefined
  transferenciaTitular?: string | undefined
  transferenciaBanco?: string | undefined
  linkMercadoPago?: string | undefined
}

/** `GET /negocios/qr-info`: los 2 QRs fijos del negocio (menu y club). */
export interface QrInfo {
  negocio: string
  qrMenu: { url: string; etiqueta: string }
  qrClub: { url: string; etiqueta: string }
}

/** `GET /google/estado`: estado de la integracion, sin tokens. */
export interface GoogleEstado {
  /** Si el backend tiene `GOOGLE_CLIENT_ID`/`SECRET`: sin eso el OAuth no se puede ni iniciar. */
  configurado: boolean
  conectado: boolean
  oauthDisponible: boolean
  integracion: {
    googleAccountId: string | null
    googleLocationId: string | null
    googleAccountName: string | null
    googleLocationName: string | null
    estado: string
    conectadoEn: string | null
    expiryDate: string | null
  } | null
}

/** Un item de `GET /google/ubicaciones` (el OAuth NO devuelve accountId/locationId: se eligen). */
export interface UbicacionGoogle {
  accountId: string
  accountName: string | null
  locationId: string
  locationName: string | null
  direccion: string | null
}

// ------------------------------------------------------------------- Fase 2: Dashboard --

/** KPIs del dia, ya con la comparacion contra ayer resuelta por el backend. */
export interface KpisDashboard {
  visitasHoy: number
  visitasAyer: number
  /** % contra ayer; `null` si ayer fue 0 y hoy no. */
  variacionVisitas: number | null
  clientesNuevosHoy: number
  clientesNuevosAyer: number
  variacionClientes: number | null
  sellosOtorgadosHoy: number
  sellosOtorgadosAyer: number
  puntosOtorgadosHoy: number
  /** Ya redondeado a 2 decimales por el backend. */
  ticketPromedio: number
  solicitudesPendientes: number
}

/**
 * `GET /estadisticas/dashboard` (cacheado en Redis: `cacheado: true` cuando lo sirvio la cache).
 * Los agregados los hace el backend con `groupBy` + un `date_trunc`: la pantalla solo dibuja.
 */
export interface DashboardAdmin {
  fecha: string
  kpis: KpisDashboard
  porSucursal: Array<{ sucursalId: string; nombre: string; slug: string | null; visitas: number; sellos: number }>
  clientesPorEtiqueta: Array<{ etiqueta: string; total: number }>
  serie7Dias: Array<{ dia: string; visitas: number }>
  cacheado?: boolean
}

/** Una fila de `GET /planes/uso-mensual` (el `UsoMensual` del periodo, con sus limites). */
export interface UsoRecurso {
  id: string
  recurso: string
  periodo: string
  /** Consumo del periodo. */
  cantidad: number
  limiteBase: number
  /** limiteBase + colchon de gracia (lo que se cobra por uso por encima). */
  limiteGracia: number
  estado: string
  payPerUse: boolean
  excedente: number
}

export interface UsoMensualAdmin {
  periodo: string
  data: UsoRecurso[]
  total: number
}

/**
 * `GET /visitas/pendientes`: la cola de solicitudes vivas.
 * El alcance lo decide el backend (multi-sucursal o la propia), no la pantalla.
 */
export interface VisitaPendiente {
  token: string
  expiraEn: string
  /** Lo calcula el backend: dos dispositivos con relojes distintos no muestran vencimientos distintos. */
  segundosRestantes: number
  cliente: { id: string; nombre: string | null; telefonoEnmascarado: string }
  sucursal: { id: string; nombre: string; slug: string } | null
}

export interface PendientesRespuesta {
  data: VisitaPendiente[]
  total: number
}

// ------------------------------------------------------------------ Media (subida a Cloudinary) --

/**
 * `POST /media/firmar-subida`: lo que el navegador necesita para subir DIRECTO a Cloudinary.
 * Nunca trae el api_secret (el backend firma y no lo expone).
 */
export interface FirmaSubida {
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  folder: string
  transformation: string
}

/** Respuesta del upload directo a Cloudinary (el subconjunto que consumimos). */
export interface RespuestaSubidaCloudinary {
  secure_url: string
  public_id: string
  format?: string
  width?: number
  height?: number
  bytes?: number
}

// ------------------------------------------------------------------ Push (plantillas) --

/** Plantilla de notificacion reutilizable (`/push/plantillas`). */
export interface PlantillaPush {
  id: string
  negocioId: string
  nombre: string
  titulo: string
  cuerpo: string
  icono: string | null
  url: string | null
  activa: boolean
  creadoEn: string
  actualizadoEn: string
}

export interface PlantillaSugerida {
  nombre: string
  titulo: string
  cuerpo: string
  url: string
}

/** `GET /push/plantillas/sugeridas`: variables soportadas + plantillas de arranque. */
export interface CatalogoPlantillas {
  variables: string[]
  sugeridas: PlantillaSugerida[]
}

/** `GET /push/plantillas/ejemplo`: datos de un cliente real para la previsualizacion. */
export interface DatosEjemploPlantilla {
  nombre: string
  negocio: string
  premio: string
  actuales: number
  meta: number
  faltantes: number
  numero: string
}

export interface CrearPlantillaBody {
  nombre: string
  titulo: string
  cuerpo: string
  icono?: string
  url?: string
  activa?: boolean
}

export type ActualizarPlantillaBody = Partial<CrearPlantillaBody>

/** Segmentos de envio por plantilla. */
export type SegmentoEnvio = 'TODOS' | 'PREMIO_DESBLOQUEADO' | 'INACTIVO_30'

export interface EnviarPlantillaBody {
  plantillaId: string
  segmento?: SegmentoEnvio
  /** Prueba a un dispositivo concreto. */
  endpoint?: string
  titulo?: string
  cuerpo?: string
  url?: string
}

export interface ResultadoEnvioPlantilla {
  encolados?: number
  destinatarios?: number
  prueba?: boolean
  enviados?: number
}
