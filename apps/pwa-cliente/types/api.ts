/**
 * Tipos de las respuestas REALES del backend.
 * Se escriben a mano (no se infieren de @repo/types) porque el contrato que
 * importa es el de los endpoints publicos/del cliente, y ese se verifico con
 * requests reales. Si el backend cambia, aca se ve el desajuste.
 */
import type { TenantTheme } from '@repo/types'

// --- catalogos chicos ---
export type ModoClientes = 'GLOBAL' | 'POR_SUCURSAL'
export type Plan = 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE'
export type TipoPedido = 'MESA' | 'TAKEAWAY' | 'DELIVERY'
export type ModoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'
export type EstadoTarjeta = 'vacia' | 'progreso' | 'casi' | 'completa' | 'canjeada'
export type EstadoVisita = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'EXPIRADA'

export interface SucursalPublica {
  id: string
  nombre: string
  slug: string
  esPrincipal: boolean
  direccion?: string | null
  telefono?: string | null
  numeroAtendiente?: string | null
  colorPrimario?: string | null
  colorSecundario?: string | null
}

/**
 * Config EFECTIVA del club. El backend devuelve la fila completa (global +
 * override de sucursal ya mergeado), asi que aca se tipan los campos que la
 * PWA usa: los que no estan listados simplemente no se leen.
 */
export interface ConfiguracionPublica {
  sellosParaPremio: number
  premioTexto: string
  menuActivo: boolean
  mostrarResenaPostVisita: boolean
  modoFidelizacion?: string
  sellosBienvenida?: number
  limiteVisitasPorDia?: number
  horasMinimasEntreVisitas?: number
  tiposPedidoHabilitados?: TipoPedido[]
  modosPagoHabilitados?: ModoPago[]
  tipoPedidoPorDefecto?: TipoPedido
  modoPagoPorDefecto?: ModoPago
  costoEnvio?: number | string | null
  pedidoMinimoDelivery?: number | string | null
  upsellActivo?: boolean
  upsellMaxSugerencias?: number
  numeroAtendiente?: string | null
  overrideAplicado?: boolean
  transferenciaAlias?: string | null
  transferenciaCbu?: string | null
  transferenciaTitular?: string | null
}

/** GET /api/negocios/publico/:slug */
export interface NegocioPublico {
  id: string
  nombre: string
  slug: string
  direccion?: string | null
  telefono?: string | null
  email?: string | null
  logoUrl?: string | null
  colorPrimario?: string | null
  colorSecundario?: string | null
  /** Personalizacion visual de la tarjeta (theme JSON). null/ausente = por defecto. */
  theme?: TenantTheme | null
  placeId?: string | null
  urlMenu?: string | null
  urlClub?: string | null
  plan: Plan
  modoClientes: ModoClientes
  activo: boolean
  configuracion: ConfiguracionPublica
  numeroAtendiente?: string | null
  sucursalActiva?: SucursalPublica | null
  sucursales: SucursalPublica[]
  /** Features del plan ya filtradas a las habilitadas (gating visual). */
  features: string[]
}

// --- cliente ---
export interface ClienteBasico {
  id: string
  nombre: string
  telefono: string
  etiqueta?: string
  totalVisitas?: number
  ultimaVisita?: string | null
  aceptaNotificaciones?: boolean
  /**
   * Token del link PUBLICO de verificacion (solo lo devuelve GET /visitas/mi-tarjeta).
   * Opcional: /auth/cliente/me y los fixtures viejos no lo traen.
   */
  tokenVerificacion?: string | null
}

export interface TarjetaSucursal {
  sucursalId: string
  sellosActuales: number
  puntosActuales: number
  totalVisitas: number
  premiosCanjeados: number
  ultimaVisita?: string | null
}

/** GET /api/auth/cliente/me */
export interface ClienteMe {
  cliente: ClienteBasico
  negocio: {
    id: string
    slug: string
    nombre: string
    plan: Plan
    logoUrl?: string | null
    colorPrimario?: string | null
    colorSecundario?: string | null
    placeId?: string | null
  }
  modoClientes: ModoClientes
  configuracion: ConfiguracionPublica
  sucursales: SucursalPublica[]
  tarjetas: TarjetaSucursal[]
  /** null con POR_SUCURSAL: ahi manda la tarjeta de la sucursal. */
  sellosActuales: number | null
  puntosActuales: number | null
  sumoHoy: boolean
  visitasHoy: number
}

/**
 * Respuestas de POST /auth/cliente/registrar y /recuperar.
 *
 * OJO: NO son `ClienteMe`. El backend devuelve un payload chico y el `negocio`
 * viene solo con {id, slug} (sin nombre, plan ni colores). Usar
 * `respuesta.negocio.colorPrimario` daria undefined en runtime; los datos del
 * local salen de GET /negocios/publico/:slug.
 */
export interface ClienteEnToken {
  id: string
  nombre: string
  telefono: string
  sellosActuales: number
  totalVisitas: number
}

export interface TokenClienteRespuesta {
  accessToken: string
  expiresIn: number
  negocio: { id: string; slug: string }
}

export interface RecuperarClienteRespuesta extends TokenClienteRespuesta {
  cliente: ClienteEnToken
}

export interface RegistroClienteRespuesta extends TokenClienteRespuesta {
  cliente: ClienteEnToken
  sucursal: { id: string; nombre: string; slug: string }
  recienCreado: boolean
}

// --- carta ---
export interface CartaItem {
  id: string
  categoria: string
  nombre: string
  descripcion?: string | null
  precio: number
  precioBase: number
  tieneOverride: boolean
  fotoUrl?: string | null
  etiquetas: string[]
  disponible: boolean
  orden: number
}

export interface CartaCategoria {
  categoria: string
  items: CartaItem[]
}

/** GET /api/carta?sucursalSlug= */
export interface CartaPublica {
  negocio: { id: string; nombre: string; slug: string }
  sucursal: { id: string; nombre: string; slug: string }
  total: number
  categorias: CartaCategoria[]
}

// --- visitas ---
export interface SolicitarVisitaRespuesta {
  token: string
  urlValidacion: string
  mensajeWhatsApp: string
  expiraEn: string
  reutilizado: boolean
  sucursal: { id: string; nombre: string; slug: string }
}

/** GET /api/visitas/estado/:token */
export interface EstadoVisitaRespuesta {
  estado: EstadoVisita
  motivo?: string
  expiraEn?: string
  sucursalId: string
  modoClientes: ModoClientes
  sellosActuales: number
  sellosParaPremio: number
  premioTexto: string
  premioDesbloqueado: boolean
  faltantes: number
  porcentaje: number
  mostrarResena: boolean
  sellosCliente: number
  sellosTarjetaSucursal: number
  puntosActuales: number
  totalVisitas: number
}

/** GET /api/visitas/mi-tarjeta */
export interface MiTarjetaRespuesta extends Omit<EstadoVisitaRespuesta, 'estado' | 'motivo' | 'expiraEn'> {
  cliente: ClienteBasico
  sucursal: SucursalPublica
  tarjetas: TarjetaSucursal[]
  /**
   * Modo del club. Con `HIBRIDO` la tarjeta muestra DOS barras (sellos + puntos); con los otros
   * modos, una sola. Opcionales para no romper a los consumidores que ya tenian la respuesta vieja
   * (un `fetch` cacheado, un fixture de test).
   */
  modoFidelizacion?: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO' | undefined
  premioPorPuntos?: number | undefined
  premioTextoPuntos?: string | null | undefined
  /**
   * Link absoluto y canonico a la pagina publica de verificacion. Lo arma el SERVIDOR con
   * `PUBLIC_APP_URL` + el slug del negocio. El front NO debe reconstruirlo con
   * `window.location.origin`: en un subdominio de tenant (`<slug>.clubio.lat`) el slug quedaria
   * duplicado y la pagina responderia "enlace no valido".
   */
  urlVerificacion?: string | null
}

/**
 * GET /api/verificacion/:token (PUBLICO, sin login).
 * Solo datos NO personales: nombre de pila, negocio y la tarjeta (sellos/premio + puntos/premio).
 */
export interface VerificacionRespuesta {
  /** Nombre de PILA (el backend corta en el primer espacio). */
  nombre: string
  negocio: {
    nombre: string
    slug: string
    logoUrl: string | null
    colorPrimario: string
    colorSecundario: string
    theme: TenantTheme | null
  }
  sellos: {
    actuales: number
    meta: number
    premioDesbloqueado: boolean
  }
  premioTexto: string
  /**
   * Premio por PUNTOS. `null`/ausente cuando el club no usa puntos (`SOLO_VISITAS`); con
   * `HIBRIDO`/`SOLO_PUNTOS` lleva el progreso real. Opcionales para no romper una respuesta
   * vieja cacheada: la pagina usa fallbacks.
   */
  puntos?: { actuales: number; meta: number; premioDesbloqueado: boolean } | null
  premioTextoPuntos?: string | null
  /** Modo del club: una barra (SOLO_VISITAS/SOLO_PUNTOS) o las dos (HIBRIDO). */
  modoFidelizacion?: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO' | undefined
  /** ISO de cuando se hizo la verificacion. */
  verificadoEn: string
}

export interface VisitaHistorial {
  id: string
  tipo: string
  metodo: string
  sellosOtorgados: number
  puntosOtorgados: number
  aprobadoEn: string
  origen?: string | null
  notas?: string | null
  sucursal?: { id: string; nombre: string; slug: string }
  empleado?: { id: string; nombre: string; rol: string }
}

export interface Paginado<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

// --- WebSocket (namespace /visitas) ---
export interface EventoVisitaAprobada {
  visitaId: string
  sucursalId: string
  sellosActuales: number
  sellosCliente: number
  sellosTarjetaSucursal: number
  premioDesbloqueado: boolean
  aprobadoEn: string
}

export interface EventoVisitaRechazada {
  motivo: string
  sucursalId: string | null
  rechazadoEn: string
}

// --- solicitar visita (lo que acepta el backend) ---
export interface SolicitarVisitaBody {
  sucursalId?: string | undefined
  sucursalSlug?: string | undefined
  origen?: string | undefined
}

/** Body de POST /api/pedidos, segun crear-pedido.dto.ts (los nombres son los del backend). */
export interface CrearPedidoBody {
  tipo: 'MESA' | 'TAKEAWAY' | 'DELIVERY'
  modoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'
  /** OJO: es nombreCliente, no nombre. */
  nombreCliente: string
  telefono: string
  direccion?: string | undefined
  /** OJO: es mesa, no numeroMesa. */
  mesa?: string | undefined
  origen?: string | undefined
  notas?: string | undefined
  items: {
    itemId: string
    cantidad: number
    notas?: string | undefined
    modificadores?: { grupoId: string; opcionIds: string[] }[] | undefined
  }[]
  sucursalId?: string | undefined
  sucursalSlug?: string | undefined
}

/** Respuesta de POST /api/pedidos (el return real de crearPedido). */
export interface PedidoCreadoRespuesta {
  pedidoId: string
  linkToken: string
  /** OJO: es urlCorta, no linkWhatsApp. */
  urlCorta: string
  /** Lo arma el backend; el cliente solo lo muestra. */
  mensajeWhatsApp: string
  expiraEn: string | null
  total: number
  sucursalId: string
}

/**
 * Respuesta de GET /api/pedidos/publico/:linkToken. Es una LISTA BLANCA: el endpoint no devuelve
 * empleadoAsignadoId, encargadoId, negocioId, sucursalId ni clienteId (ver TROUBLESHOOTING).
 * Los Decimal ya vienen como number y los items como JSON con la forma que armo calcularTotales.
 */
export interface ItemDePedidoPublico {
  itemId: string
  nombre: string
  precioBase: number
  precioFinal: number
  cantidad: number
  notas?: string | null | undefined
  modificadores: { grupoId: string; grupoNombre: string; opcionId: string; opcionNombre: string; precioExtra: number }[]
  subtotal: number
}

export interface PedidoPublico {
  id: string
  linkToken: string | null
  linkExpiraEn: string | null
  nombreCliente: string
  telefono: string
  direccion: string | null
  mesa: string | null
  origen: string | null
  tipo: 'MESA' | 'TAKEAWAY' | 'DELIVERY'
  modoPago: 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'
  estado: 'PENDIENTE' | 'CONFIRMADO' | 'EN_PREPARACION' | 'LISTO' | 'ENVIADO' | 'ENTREGADO' | 'CANCELADO' | 'RECHAZADO'
  notas: string | null
  motivoRechazo: string | null
  subtotal: number
  costoEnvio: number | null
  total: number
  numeroAtendiente: string | null
  items: ItemDePedidoPublico[]
  creadoEn: string
  confirmadoEn: string | null
  enviadoEn: string | null
  entregadoEn: string | null
  sucursal: { nombre: string; slug: string }
  cliente: { nombre: string } | null
}
