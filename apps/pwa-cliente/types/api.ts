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
  /** Switch del LOCAL: con `true`, una sucursal con su propio numero lo usa en vez del del local. */
  usarNumeroAtendienteDistinto?: boolean
  overrideAplicado?: boolean
  transferenciaAlias?: string | null
  transferenciaCbu?: string | null
  transferenciaTitular?: string | null
  /** Grillas semanales de horarios: { lun: [{desde,hasta}], ... }. Faltante/null = sin horarios. */
  horariosAtencion?: HorarioSemana | null
  horariosDelivery?: HorarioSemana | null
  /**
   * Perfilado progresivo: a partir de que visita se le pregunta el cumpleaños al cliente
   * (default del backend: 3). Opcional: si no viene, la PWA no pregunta nada todavia
   * (ver lib/perfilamiento-maquina.ts).
   */
  perfilDesdeVisita?: number
}

/** Dias en el orden del editor (lunes primero). Claves del JSON de la grilla. */
export type DiaSemana = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'

export interface RangoHorario {
  desde: string
  hasta: string
}

export type HorarioSemana = Partial<Record<DiaSemana, RangoHorario[]>>

/** Feriado / cierre temporal. Fechas YYYY-MM-DD en hora ARGENTINA. */
export interface ExcepcionHorario {
  desdeFecha: string
  hastaFecha: string
  motivo?: string | null
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
  /** Cierres/feriados del local (ventana corta): el navegador calcula "abierto" con esto. */
  excepciones?: ExcepcionHorario[]
}

// --- cliente ---
/**
 * Genero declarado por el cliente (perfilado progresivo, fase 1). Sale del contrato del backend:
 * PATCH /auth/cliente/perfil acepta estos valores y GET /auth/cliente/me los devuelve.
 * `PREFIERO_NO_DECIR` es una RESPUESTA valida, no un "vacio": no se vuelve a preguntar.
 */
export type Genero = 'FEMENINO' | 'MASCULINO' | 'NO_BINARIO' | 'OTRO' | 'PREFIERO_NO_DECIR'

export interface ClienteBasico {
  id: string
  nombre: string
  telefono: string
  etiqueta?: string
  totalVisitas?: number
  ultimaVisita?: string | null
  aceptaNotificaciones?: boolean
  /**
   * Perfilado progresivo (opcionales a proposito: mientras el backend no los exponga llegan
   * `undefined` y la PWA NO pregunta nada; ver lib/perfilamiento-maquina.ts).
   */
  fechaNacimiento?: string | null
  genero?: Genero | null
  /** true = el cliente pidio que no le pidan mas datos. Nunca se le vuelve a preguntar. */
  perfiladoRechazado?: boolean
  /** ISO en que el cliente cerro/omitio el cartel (cooldown del lado del servidor). */
  perfiladoOmitidoEn?: string | null
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
  /**
   * Premios GANADOS por el cliente (bloque "Tus premios ganados"). Scoped por JWT en el backend.
   * Opcional: una respuesta vieja cacheada no lo trae y la seccion simplemente no se dibuja.
   *
   * OJO: esto NO es el premio del CLUB (el de la meta de sellos/puntos, que sale de
   * `premiosDesbloqueados` en la pantalla). Son dos conceptos distintos y la UI los rotula distinto.
   */
  premios?: PremioGanado[]
  /** Total real de premios del cliente. El array viene CAPADO: si `premiosTotal > premios.length`
   *  hay mas en el historial. */
  premiosTotal?: number
}

/**
 * Un premio GANADO (un `PremioOtorgado`), tal como lo devuelve `premios[]` de
 * `GET /api/visitas/mi-tarjeta`.
 *
 * `estado` viene COMPUTADO por el backend: si la fila esta PENDIENTE pero `expiraEn` ya paso, llega
 * VENCIDO igual (el backend es el unico que puede saberlo: nadie persiste el vencimiento).
 */
export interface PremioGanado {
  token: string
  tipo: TipoPremio
  cantidad: number
  texto: string
  expiraEn: string | null
  expiraLegible: string | null
  aceptadoEn: string | null
  canjeadoEn: string | null
  creadoEn: string
  disparoNombre: string | null
  campanaNombre: string | null
  estado: EstadoPremio
  /**
   * Mecanismo de canje: link del staff (`staff.../validar-premio?ref=<token>`) + WhatsApp al numero
   * de atencion del local. Presente en ACEPTADO y CANJEADO, `null` en PENDIENTE/VENCIDO.
   *
   * ES LO QUE ARREGLA EL PREMIO PERDIDO: un premio ACEPTADO (sobre todo un LIBRE, que no mueve
   * saldo) se recupera de aca aunque el cliente haya cerrado la modal de aceptar.
   */
  verificacion: PremioVerificacion | null
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

/** Estado del ciclo de vida de un premio aceptado desde la notificacion. */
export type EstadoPremio = 'PENDIENTE' | 'ACEPTADO' | 'CANJEADO' | 'VENCIDO'
export type TipoPremio = 'SELLOS' | 'PUNTOS' | 'LIBRE'

/**
 * Premio que el cliente ACEPTA desde la notificacion (GET /api/premios/:token). Publico:
 * el token de la URL es la unica llave. Solo el nombre de PILA del cliente (privacidad).
 */
export interface PremioPublico {
  token: string
  estado: EstadoPremio
  tipo: TipoPremio
  cantidad: number
  texto: string
  expiraEn: string | null
  expiraLegible: string | null
  aceptadoEn: string | null
  canjeadoEn: string | null
  disparoNombre: string | null
  campanaNombre: string | null
  cliente: { nombre: string }
  negocio: {
    nombre: string
    slug: string | null
    logoUrl: string | null
    colorPrimario: string | null
    colorSecundario: string | null
    theme: TenantTheme | null
  }
  premioTexto: string | null
  modoFidelizacion: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO'
  /**
   * Par antes/despues del saldo (sellos y puntos efectivos) para VERIFICAR el cambio en la modal.
   * En un premio PENDIENTE el `despues` es la PROYECCION de lo que acreditara; en uno ya aceptado
   * es el par que quedo registrado al aceptar. Ausente en respuestas viejas.
   */
  saldo?: SaldoParCambio | null
  /**
   * Mecanismo de canje. `null`/ausente mientras el premio este PENDIENTE; presente con el
   * premio ACEPTADO/CANJEADO (asi la modal lo muestra tambien al recargar la pagina).
   */
  verificacion?: PremioVerificacion | null
}

/** Par de saldos (sellos + puntos efectivos) antes y despues de aceptar un premio. */
export interface SaldoParCambio {
  antes: { sellos: number; puntos: number }
  despues: { sellos: number; puntos: number }
}

/** Mecanismo de canje (link de verificacion + WhatsApp al numero de atencion del local). */
export interface PremioVerificacion {
  url: string
  whatsapp: string | null
  numero: string | null
  mensaje: string
  texto: string
}

/** Respuesta de POST /api/premios/:token/aceptar. */
export interface PremioAceptarRespuesta extends PremioPublico {
  ok: boolean
  motivo: 'vencido' | 'ya-aceptado' | null
  yaAceptado: boolean
  acreditado: { sellos: number; puntos: number }
  verificacion: PremioVerificacion | null
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
