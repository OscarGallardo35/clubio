import type {
  CanalCampana, EstadoLead, EstadoPedido, EstadoSuscripcion, EstadoUso,
  EtiquetaCliente, MetodoVisita, ModoAsignacionPedidos, ModoClientes, ModoFidelizacion,
  ModoPago, Plan, RecursoLimitado, RolEmpleado, TipoModificador, TipoPedido, TipoTurno, TipoVisita,
} from './enums';
import type { TenantTheme } from './theme';

/** Las fechas viajan como ISO string en las respuestas JSON. */
export type FechaISO = string;
/** Prisma serializa Decimal como string en JSON (ej: "1500.00"). */
export type MontoDecimal = string;

export interface Negocio {
  id: string;
  nombre: string;
  slug: string;
  cuit?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  colorPrimario: string;
  colorSecundario: string;
  placeId?: string | null;
  urlMenu?: string | null;
  urlClub?: string | null;
  plan: Plan;
  modoClientes: ModoClientes;
  payPerUseActivo: boolean;
  activo: boolean;
  /** Personalizacion visual de la tarjeta. null/ausente = diseno por defecto. */
  theme?: TenantTheme | null;
  creadoEn: FechaISO;
  actualizadoEn: FechaISO;
  eliminadoEn?: FechaISO | null;
}

export interface Sucursal {
  id: string;
  negocioId: string;
  nombre: string;
  slug: string;
  direccion?: string | null;
  telefono?: string | null;
  numeroAtendiente?: string | null;
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  activa: boolean;
  esPrincipal: boolean;
  creadoEn: FechaISO;
  actualizadoEn: FechaISO;
}

export interface ConfiguracionClub {
  id: string;
  negocioId: string;
  beneficioCumpleanosActivo: boolean;
  descripcionBeneficioCumpleanos?: string | null;
  diasValidezCumpleanos: number;
  modoFidelizacion: ModoFidelizacion;
  sellosParaPremio: number;
  premioTexto: string;
  sellosBienvenida: number;
  limiteVisitasPorDia: number;
  horasMinimasEntreVisitas: number;
  puntosPorPeso?: MontoDecimal | null;
  premioPorPuntos?: number | null;
  requiereValidacionEmpleado: boolean;
  permiteRegaloManual: boolean;
  mensajeBienvenida?: string | null;
  mostrarResenaPostVisita: boolean;
  permitirOverrideSucursal: boolean;
  colchonGraciaDefault: number;
  menuActivo: boolean;
  tiposPedidoHabilitados: TipoPedido[];
  modosPagoHabilitados: ModoPago[];
  costoEnvio?: MontoDecimal | null;
  pedidoMinimoDelivery?: MontoDecimal | null;
  zonaEntrega?: string | null;
  modoPagoPorDefecto: ModoPago;
  tipoPedidoPorDefecto: TipoPedido;
  forzarTakeawaySiNoHayMesas: boolean;
  numeroAtendiente?: string | null;
  usarNumeroAtendienteDistinto: boolean;
  modoAsignacionPedidos: ModoAsignacionPedidos;
  transferenciaAlias?: string | null;
  transferenciaCbu?: string | null;
  transferenciaTitular?: string | null;
  transferenciaBanco?: string | null;
  transferenciaNotas?: string | null;
  linkMercadoPago?: string | null;
  upsellActivo: boolean;
  upsellMaxSugerencias: number;
  turnosActivos: boolean;
  checkinObligatorio: boolean;
  duplicarSemanaAuto: boolean;
  pushInactividad3Dias: boolean;
  pushCumpleanos: boolean;
  pushPremioPorVencer: boolean;
  pushAUnoDelPremio: boolean;
  pushInactivos30Dias: boolean;
}

export interface ConfiguracionSucursal {
  id: string;
  sucursalId: string;
  premioTexto?: string | null;
  sellosParaPremio?: number | null;
  sellosBienvenida?: number | null;
  limiteVisitasPorDia?: number | null;
  horasMinimasEntreVisitas?: number | null;
  tiposPedidoHabilitados: TipoPedido[];
  modosPagoHabilitados: ModoPago[];
  costoEnvio?: MontoDecimal | null;
  pedidoMinimoDelivery?: MontoDecimal | null;
  zonaEntrega?: string | null;
  transferenciaAlias?: string | null;
  transferenciaCbu?: string | null;
  transferenciaTitular?: string | null;
  transferenciaBanco?: string | null;
}

export interface Empleado {
  id: string;
  negocioId: string;
  sucursalId: string;
  nombre: string;
  rol: RolEmpleado;
  email?: string | null;
  telefono?: string | null;
  avatarUrl?: string | null;
  twoFactorEnabled: boolean;
  emailVerificado: boolean;
  accesoMultiSucursal: boolean;
  activo: boolean;
  ultimoAcceso?: FechaISO | null;
  creadoEn: FechaISO;
}

export interface Cliente {
  id: string;
  negocioId: string;
  nombre: string;
  telefono: string;
  email?: string | null;
  fechaNacimiento?: FechaISO | null;
  aceptaNotificaciones: boolean;
  tienePwaInstalada: boolean;
  sellosActuales: number;
  puntosActuales: number;
  totalVisitas: number;
  premiosCanjeados: number;
  etiqueta: EtiquetaCliente;
  notasInternas?: string | null;
  creadoEn: FechaISO;
  ultimaVisita?: FechaISO | null;
}

export interface TarjetaClienteSucursal {
  id: string;
  clienteId: string;
  sucursalId: string;
  sellosActuales: number;
  puntosActuales: number;
  totalVisitas: number;
  premiosCanjeados: number;
  ultimaVisita?: FechaISO | null;
}

export interface Visita {
  id: string;
  negocioId: string;
  sucursalId: string;
  clienteId: string;
  empleadoId: string;
  tipo: TipoVisita;
  sellosOtorgados: number;
  puntosOtorgados: number;
  montoConsumido?: MontoDecimal | null;
  aprobadoEn: FechaISO;
  metodo: MetodoVisita;
  origen?: string | null;
  notas?: string | null;
}

export interface ItemCarta {
  id: string;
  negocioId: string;
  categoria: string;
  nombre: string;
  descripcion?: string | null;
  precio: MontoDecimal;
  fotoUrl?: string | null;
  etiquetas: string[];
  disponible: boolean;
  orden: number;
  creadoEn: FechaISO;
}

export interface ItemCartaSucursal {
  id: string;
  itemCartaId: string;
  sucursalId: string;
  precio?: MontoDecimal | null;
  disponible?: boolean | null;
}

export interface GrupoModificador {
  id: string;
  negocioId: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoModificador;
  obligatorio: boolean;
  minSelecciones: number;
  maxSelecciones?: number | null;
  orden: number;
}

export interface OpcionModificador {
  id: string;
  grupoModificadorId: string;
  nombre: string;
  precioExtra: MontoDecimal;
  disponible: boolean;
  orden: number;
}

export interface ReglaUpsell {
  id: string;
  negocioId: string;
  nombre: string;
  activa: boolean;
  prioridad: number;
  mensaje: string;
  itemOrigenId?: string | null;
  categoriaOrigen?: string | null;
  itemDestinoId: string;
  maxVeces?: number | null;
  soloUnaVez: boolean;
}

export interface ItemPedido {
  itemId: string;
  nombre: string;
  precioBase: number;
  precioFinal: number;
  cantidad: number;
  notas?: string;
  modificadores?: Array<{
    grupoId: string;
    grupoNombre: string;
    opcionId: string;
    opcionNombre: string;
    precioExtra: number;
  }>;
  subtotal: number;
}

export interface Pedido {
  id: string;
  negocioId: string;
  sucursalId: string;
  clienteId?: string | null;
  nombreCliente: string;
  telefono: string;
  direccion?: string | null;
  origen?: string | null;
  mesa?: string | null;
  tipo: TipoPedido;
  modoPago: ModoPago;
  items: ItemPedido[];
  subtotal: MontoDecimal;
  costoEnvio?: MontoDecimal | null;
  total: MontoDecimal;
  notas?: string | null;
  estado: EstadoPedido;
  motivoRechazo?: string | null;
  empleadoAsignadoId?: string | null;
  numeroAtendiente?: string | null;
  linkToken?: string | null;
  linkExpiraEn?: FechaISO | null;
  creadoEn: FechaISO;
  actualizadoEn: FechaISO;
}

export interface Turno {
  id: string;
  negocioId: string;
  sucursalId: string;
  empleadoId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  tipoTurno: TipoTurno;
  notas?: string | null;
}

export interface EncargadoDia {
  id: string;
  negocioId: string;
  sucursalId: string;
  empleadoId: string;
  fecha: string;
}

export interface CheckinTurno {
  id: string;
  negocioId: string;
  sucursalId: string;
  empleadoId: string;
  turnoId?: string | null;
  checkinEn: FechaISO;
  checkoutEn?: FechaISO | null;
  notas?: string | null;
}

export interface ResenaGoogle {
  id: string;
  negocioId: string;
  reviewId: string;
  autorNombre: string;
  autorFotoUrl?: string | null;
  estrellas: number;
  texto?: string | null;
  fechaResena: FechaISO;
  respondida: boolean;
  respuestaTexto?: string | null;
}

export interface IntegracionGoogle {
  id: string;
  negocioId: string;
  googleAccountId?: string | null;
  googleLocationId?: string | null;
  googleAccountName?: string | null;
  googleLocationName?: string | null;
  estado: string;
  conectadoEn: FechaISO;
}

export interface NotificacionPush {
  id: string;
  negocioId: string;
  clienteId: string;
  endpoint: string;
  activa: boolean;
  ultimoUso: FechaISO;
}

export interface CampanaMarketing {
  id: string;
  negocioId: string;
  titulo: string;
  mensaje: string;
  url?: string | null;
  icono?: string | null;
  segmento: string;
  canal: CanalCampana;
  esAutomatizacion: boolean;
  enviadaEn?: FechaISO | null;
  totalEnviados: number;
  totalFallidos: number;
  totalAbiertos: number;
}

export interface PlanFeature {
  id: string;
  plan: Plan;
  feature: string;
  habilitada: boolean;
  limite?: number | null;
  metadata?: unknown;
}

export interface UsoMensual {
  id: string;
  negocioId: string;
  sucursalId?: string | null;
  recurso: RecursoLimitado;
  periodo: string;
  cantidad: number;
  limiteBase: number;
  limiteGracia: number;
  estado: EstadoUso;
  payPerUse: boolean;
  excedente: number;
}

export interface Lead {
  id: string;
  nombreNegocio: string;
  nombreContacto: string;
  email: string;
  telefono: string;
  tipoNegocio: string;
  ciudad?: string | null;
  cantidadSucursales: number;
  planInteresado: Plan;
  estado: EstadoLead;
  origen: string;
  creadoEn: FechaISO;
}

export interface SuperAdmin {
  id: string;
  email: string;
  nombre: string;
  twoFactorEnabled: boolean;
  activo: boolean;
  creadoEn: FechaISO;
  ultimoAcceso?: FechaISO | null;
}

export interface Suscripcion {
  id: string;
  negocioId: string;
  plan: Plan;
  estado: EstadoSuscripcion;
  precioMensual?: MontoDecimal | null;
  moneda: string;
  fechaInicio: FechaISO;
  fechaProximoPago?: FechaISO | null;
  fechaCancelacion?: FechaISO | null;
  metodoPago?: string | null;
}

/** Contexto del usuario autenticado que devuelven las estrategias JWT. */
export interface UsuarioAutenticado {
  id: string;
  negocioId: string;
  negocioSlug?: string;
  sucursalId?: string;
  tipo: 'empleado' | 'dueno' | 'cliente';
  rol?: RolEmpleado;
  nombre?: string;
  telefono?: string;
}
