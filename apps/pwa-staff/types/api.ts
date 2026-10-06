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
}

/** POST /visitas/aprobar/:token */
export interface RespuestaAprobacion {
  success: true
  visitaId: string
  sucursalId: string
  modoClientes: 'GLOBAL' | 'POR_SUCURSAL'
  sellosActuales: number
  sellosCliente: number
  sellosTarjetaSucursal: number
  premioDesbloqueado: boolean
  mostrarResena: boolean
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
  cliente: { id: string; nombre: string }
  sucursal: { id: string; nombre: string; slug: string } | null
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

/** Un item del pedido tal como se guarda (columna Json `items`). */
export interface ItemPedido {
  itemId?: string
  nombre?: string
  cantidad?: number
  precioUnitario?: number
  subtotal?: number
  notas?: string
  modificadores?: { grupoId?: string; grupo?: string; opciones?: { id?: string; nombre?: string; precio?: number }[] }[]
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
  creadoEn: string
  confirmadoEn: string | null
  enviadoEn: string | null
  entregadoEn: string | null
  sucursal: { id: string; nombre: string; slug: string } | null
  cliente?: { id: string; nombre: string } | null
  empleadoAsignado?: { id: string; nombre: string } | null
}
