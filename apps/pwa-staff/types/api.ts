/**
 * Tipos de la PWA Staff.
 *
 * La forma de `/auth/empleado/me` esta verificada contra el backend (no de
 * memoria): tipo, empleado{id,nombre,rol,accesoMultiSucursal,sucursal},
 * negocio{...publico, plan, features} y sucursal.
 */
export interface SucursalStaff {
  id: string;
  nombre: string;
  slug: string;
  esPrincipal: boolean;
  direccion: string | null;
  telefono: string | null;
}

export interface EmpleadoStaff {
  id: string;
  nombre: string;
  rol: string;
  accesoMultiSucursal: boolean;
  sucursal: SucursalStaff | null;
}

/** Features del plan: { clientes: { habilitada: true, limite: 500 }, ... } */
export interface FeaturesPlan {
  plan: string;
  features: Record<string, { habilitada: boolean; limite: number | null }>;
}

/**
 * El negocio tal como lo devuelve el endpoint publico (branding + configuracion).
 * Se tipan los campos que la Staff USA y se dejan pasar los demas: el shape
 * publico crece con cada feature y no queremos un tipo que mienta por omision.
 */
export interface NegocioStaff {
  id: string;
  nombre: string;
  slug: string;
  plan: string;
  features: FeaturesPlan['features'];
  logoUrl?: string | null;
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  [clave: string]: unknown;
}

export interface EmpleadoMe {
  tipo: 'DUENO' | 'EMPLEADO';
  empleado: EmpleadoStaff;
  negocio: NegocioStaff;
  sucursal: SucursalStaff | null;
}

export interface LoginEmpleadoRespuesta {
  accessToken: string;
  expiresIn: number;
  empleado: { id: string; nombre: string; rol: string; sucursalId: string | null };
  negocio: { id: string; slug: string; nombre: string };
}

// ---------------------------------------------------------------------------
// Visitas (staff). Formas REALES leidas de visitas.service.ts.
// ---------------------------------------------------------------------------

/** Item de `pedidosCandidatos` en `GET /visitas/validar/:token` (Fase 1: vinculo visita-pedido). */
export interface PedidoCandidato {
  id: string
  total: number
  estado: string
  creadoEn: string
  entregadoEn: string | null
  mesa: string | null
  items: unknown
  /** true = pedido de invitado que coincide por telefono: SUGERENCIA, no vinculo seguro. */
  porTelefono: boolean
}

/** GET /visitas/validar/:token */
export interface VisitaValidable {
  token: string
  estado: 'VALIDO' | 'USADO' | 'EXPIRADO'
  expiraEn: string
  sucursalId: string | null
  sucursal: { id: string; nombre: string; slug: string; esPrincipal: boolean } | null
  cliente: {
    id: string
    nombre: string
    /** Viene ENMASCARADO del backend (enmascararTelefono). */
    telefono: string
    sellosActuales: number
    puntosActuales: number
    totalVisitas: number
    etiqueta: string | null
    ultimaVisita: string | null
  }
  /** Pedidos del menu del mismo cliente (o del mismo telefono si es invitado) en las ultimas 3 h. */
  pedidosCandidatos: PedidoCandidato[]
}

/** POST /visitas/aprobar/:token */
export interface RespuestaAprobacion {
  success: true
  visitaId: string
  sucursalId: string
  modoClientes: 'GLOBAL' | 'POR_SUCURSAL'
  /** Modo de fidelizacion vigente: con SOLO_PUNTOS no se otorga sello. */
  modoFidelizacion: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO'
  /** Lo que OTORGO esta aprobacion (no el saldo). */
  sellosOtorgados: number
  puntosOtorgados: number
  sellosActuales: number
  sellosCliente: number
  sellosTarjetaSucursal: number
  puntosActuales: number
  puntosTarjetaSucursal: number
  sellosParaPremio: number
  premioPorPuntos: number
  premioDesbloqueado: boolean
  premioPuntosDesbloqueado: boolean
  mostrarResena: boolean
}

/** POST /visitas/canjear */
export interface RespuestaCanje {
  success: true
  tipo: TipoCanje
  /** Cuanto costo el premio (sellos o puntos). */
  costo: number
  premioTexto: string
  sellosActuales: number
  puntosActuales: number
  premiosCanjeados: number
  ultimoCanjeEn: string | null
  premioDesbloqueado: boolean
  premioPuntosDesbloqueado: boolean
}

export type TipoCanje = 'SELLOS' | 'PUNTOS'

/**
 * `GET /configuracion/efectiva` (JwtEmpleadoGuard): la config del club ya resuelta para la sucursal
 * del empleado. Es lo que necesita el staff para saber si el club da puntos y cuanto vale cada uno.
 *
 * OJO: la tasa y el umbral de puntos NO se pueden overridear por sucursal (`CAMPOS_OVERRIDE` no los
 * incluye): son del club.
 */
export interface ConfiguracionEfectivaStaff {
  modoFidelizacion: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO'
  puntosPorMil: number | null
  premioPorPuntos: number | null
  premioTextoPuntos: string | null
  sellosParaPremio: number
  premioTexto: string
  overrideAplicado?: boolean
  sucursalId?: string
}

/** POST /visitas/rechazar/:token */
export interface RespuestaRechazo {
  success: true
}

/**
 * Fila de `GET /visitas/mis-aprobaciones`.
 *
 * OJO CON EL NOMBRE: este endpoint NO lista solicitudes pendientes. Devuelve las
 * visitas que ESE empleado ya aprobo HOY (`{ data, total, desde }`). El nombre
 * invita a confundirlo; se deja dicho aca para que nadie lo use como cola de
 * pendientes.
 */
export interface VisitaAprobada {
  id: string
  clienteId: string
  sucursalId: string | null
  aprobadoEn: string | null
  sellosOtorgados: number
  /** Fase 2: lo que se le acredito a esta visita (editable con PATCH /visitas/:id/monto). */
  puntosOtorgados: number
  montoConsumido: number | null
  cliente: { id: string; nombre: string }
  sucursal: { id: string; nombre: string; slug: string } | null
}

/** Respuesta de `PATCH /visitas/:id/monto` (Fase 2). */
export interface RespuestaEditarMonto {
  ok: true
  visitaId: string
  montoAntes: number | null
  montoDespues: number
  puntosAntes: number
  puntosDespues: number
  saldoDespues: number
}

/** Payload del WS `visita:solicitada` (a la sala de la sucursal + duenos). */
export interface VisitaSolicitadaWs {
  negocioId: string
  sucursalId: string
  token: string
  expiraEn: string
  emitidoEn: string
}

/** Item de `GET /visitas/pendientes` (la cola de solicitudes vivas). */
export interface VisitaPendiente {
  token: string
  expiraEn: string
  /** Calculado en el BACKEND, para que dos dispositivos no muestren vencimientos distintos. */
  segundosRestantes: number
  cliente: { id: string; nombre: string; telefonoEnmascarado: string }
  sucursal: { id: string; nombre: string; slug: string } | null
}

// ---------------------------------------------------------------------------
// Pedidos (staff). Estados y transiciones REALES de
// apps/backend/src/pedidos/helpers/transiciones-estado.ts
// ---------------------------------------------------------------------------
export type EstadoPedido =
  | 'PENDIENTE' | 'CONFIRMADO' | 'EN_PREPARACION' | 'LISTO' | 'ENVIADO'
  | 'ENTREGADO' | 'CANCELADO' | 'RECHAZADO'

export type TipoPedido = 'MESA' | 'TAKEAWAY' | 'DELIVERY'
export type ModoPagoPedido = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'

/** Envelope unico de los listados de la API. */
export interface Paginado<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * Un item dentro de la columna Json `Pedido.items`.
 * Forma REAL de `apps/backend/src/pedidos/interfaces/pedido-item.interface.ts`:
 * `precioBase` es el de carta (con override de sucursal) y `precioFinal` es
 * precioBase + la suma de los `precioExtra` elegidos. `subtotal` viene ya calculado.
 * Un registro de modificador por OPCION elegida.
 */
export interface ModificadorElegido {
  grupoId: string
  grupoNombre: string
  opcionId: string
  opcionNombre: string
  precioExtra: number
}

export interface ItemPedido {
  itemId: string
  nombre: string
  precioBase: number
  precioFinal: number
  cantidad: number
  notas?: string
  modificadores: ModificadorElegido[]
  subtotal: number
}

export interface PedidoStaff {
  id: string
  sucursalId: string
  clienteId: string | null
  nombreCliente: string
  telefono: string
  direccion: string | null
  origen: string | null
  mesa: string | null
  tipo: TipoPedido
  modoPago: ModoPagoPedido
  items: ItemPedido[]
  subtotal: number
  costoEnvio: number | null
  total: number
  notas: string | null
  estado: EstadoPedido
  motivoRechazo: string | null
  empleadoAsignadoId: string | null
  numeroAtendiente: string | null
  linkToken: string | null
  /**
   * Mensaje pre-armado para reenviarle al cliente por WhatsApp.
   * OJO: el backend lo manda SOLO si el link del pedido sigue vivo (si el `linkToken` ya se
   * limpio o vencio, no viene) — por eso es opcional y el boton se muestra solo si existe.
   */
  mensajeWhatsApp?: string | undefined
  creadoEn: string
  confirmadoEn: string | null
  enviadoEn: string | null
  entregadoEn: string | null
  sucursal: { id: string; nombre: string; slug: string } | null
  cliente?: { id: string; nombre: string } | null
  empleadoAsignado?: { id: string; nombre: string } | null
}

// ---------------------------------------------------------------------------
// Carta (staff). OJO: estos endpoints son DUENO/ENCARGADO (RolesGuard), no de
// cualquier empleado. Y la feature que los habilita se llama 'menu' (no 'carta').
// ---------------------------------------------------------------------------
export interface ItemCarta {
  id: string
  categoria: string
  nombre: string
  descripcion: string | null
  /** Decimal(10,2) en la DB; la API lo manda como number. */
  precio: number
  fotoUrl: string | null
  etiquetas: string[]
  disponible: boolean
  orden: number
}

/** Body de PATCH /carta/:id. Todo opcional; solo se manda lo que cambio. */
export interface ActualizarItemCartaBody {
  categoria?: string
  nombre?: string
  descripcion?: string
  precio?: number
  fotoUrl?: string
  etiquetas?: string[]
  disponible?: boolean
  orden?: number
}

/** Envelope REAL de GET /carta/admin: agrupado por categoria (no es {data,...}). */
export interface GrupoCarta {
  categoria: string
  items: ItemCarta[]
}

export interface CartaAdminRespuesta {
  total: number
  categorias: GrupoCarta[]
}
