// Tipos compartidos entre frontend y backend
// NO importar Prisma aquí para evitar acoplar el frontend al ORM

// ============ Enums ============
export enum Plan {
  GRATIS = 'GRATIS',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE'
}

export enum RolEmpleado {
  ADMIN_LOCAL = 'ADMIN_LOCAL',
  CAMARERO = 'CAMARERO',
  COCINERO = 'COCINERO'
}

export enum ModoFidelizacion {
  SELLOS = 'SELLOS',
  PUNTOS = 'PUNTOS',
  VISITAS = 'VISITAS'
}

export enum EtiquetaCliente {
  NUEVO = 'NUEVO',
  RECURRENTE = 'RECURRENTE',
  VIP = 'VIP',
  INACTIVO = 'INACTIVO'
}

export enum TipoVisita {
  QR_CLUB = 'QR_CLUB',
  QR_MENU = 'QR_MENU',
  MANUAL = 'MANUAL'
}

export enum MetodoVisita {
  QR = 'QR',
  MANUAL = 'MANUAL',
  PROMOCION = 'PROMOCION'
}

export enum CanalCampana {
  PUSH = 'PUSH',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP'
}

export enum EstadoPedido {
  PENDIENTE = 'PENDIENTE',
  CONFIRMADO = 'CONFIRMADO',
  EN_PREPARACION = 'EN_PREPARACION',
  LISTO = 'LISTO',
  ENTREGADO = 'ENTREGADO',
  CANCELADO = 'CANCELADO'
}

// ============ Interfaces principales ============
export interface Negocio {
  id: string
  nombre: string
  slug: string
  plan: Plan
  telefono: string
  email: string
  direccion: string
  ciudad: string
  pais: string
  logoUrl?: string
  fotoPortadaUrl?: string
  latitud?: number
  longitud?: number
  tiempoApertura: string
  tiempoCierre: string
  createdAt: Date
  updatedAt: Date
}

export interface ConfiguracionClub {
  negocioId: string
  modoFidelizacion: ModoFidelizacion
  sellosParaRegalo: number
  puntosPorVisita: number
  visitasParaRegalo: number
  regaloNombre: string
  regaloDescripcion?: string
  regaloImagenUrl?: string
  permiteAutoAprobar: boolean
  requiereVerificacionStaff: boolean
  duracionSesionHoras: number
  createdAt: Date
  updatedAt: Date
}

export interface Empleado {
  id: string
  negocioId: string
  nombre: string
  email: string
  telefono: string
  rol: RolEmpleado
  pin: string
  activo: boolean
  ultimoAcceso?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Cliente {
  id: string
  negocioId: string
  nombre: string
  telefono: string
  email?: string
  fechaNacimiento?: Date
  sellosActuales: number
  sellosTotales: number
  puntosActuales: number
  puntosTotales: number
  visitasTotales: number
  ultimaVisita?: Date
  etiqueta: EtiquetaCliente
  preferencias?: Record<string, any>
  activo: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Visita {
  id: string
  negocioId: string
  clienteId: string
  empleadoId?: string
  tipo: TipoVisita
  metodo: MetodoVisita
  aprobada: boolean
  fechaAprobacion?: Date
  sellosOtorgados: number
  puntosOtorgados: number
  observaciones?: string
  createdAt: Date
}

export interface TokenValidacion {
  id: string
  negocioId: string
  clienteId: string
  token: string
  tipo: 'WHATSAPP' | 'EMAIL'
  usado: boolean
  expiraEn: Date
  createdAt: Date
}

export interface ResenaGoogle {
  id: string
  negocioId: string
  googlePlaceId: string
  autorNombre: string
  autorFotoUrl?: string
  rating: number
  texto: string
  fechaResena: Date
  idioma: string
  respuestaEmpresa?: string
  respuestaFecha?: Date
  sincronizadoEn: Date
}

export interface ItemCarta {
  id: string
  negocioId: string
  nombre: string
  descripcion?: string
  precio: number
  categoria: string
  orden: number
  imagenUrl?: string
  activo: boolean
  createdAt: Date
  updatedAt: Date
}

export interface PedidoDelivery {
  id: string
  negocioId: string
  clienteId: string
  empleadoId?: string
  items: Array<{
    itemId: string
    nombre: string
    cantidad: number
    precioUnitario: number
  }>
  total: number
  estado: EstadoPedido
  direccionEntrega: string
  telefonoContacto: string
  notas?: string
  estimadoMinutos?: number
  createdAt: Date
  updatedAt: Date
}

export interface NotificacionPush {
  id: string
  negocioId: string
  clienteId: string
  titulo: string
  mensaje: string
  data?: Record<string, any>
  leida: boolean
  enviadaEn: Date
  leidaEn?: Date
}

export interface CampanaMarketing {
  id: string
  negocioId: string
  nombre: string
  mensaje: string
  canal: CanalCampana
  destinatarios: 'TODOS' | 'ETIQUETA' | 'INDIVIDUAL'
  filtroEtiqueta?: EtiquetaCliente
  clienteIds?: string[]
  programadaPara?: Date
  enviada: boolean
  enviadaEn?: Date
  createdAt: Date
}

// ============ DTOs de respuesta ============
export interface DashboardKPIs {
  clientesTotales: number
  clientesActivos: number
  visitasHoy: number
  visitasMes: number
  promedioRating: number
  pedidosPendientes: number
  ingresosHoy: number
  ingresosMes: number
}

export interface SolicitudPendiente {
  visitaId: string
  clienteId: string
  clienteNombre: string
  clienteTelefono: string
  tipoVisita: TipoVisita
  fechaSolicitud: Date
  sellosOtorgados: number
}

export interface ClienteConSellos extends Cliente {
  progreso: {
    porcentaje: number
    faltantes: number
    completado: boolean
  }
  ultimoRegalo?: Date
}

export interface VisitaConEmpleado extends Visita {
  empleadoNombre?: string
  clienteNombre: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  usuario: {
    id: string
    nombre: string
    email: string
    rol: RolEmpleado
    negocioId: string
    negocioNombre: string
  }
}

export interface LoginResponse {
  requiere2FA: boolean
  token2FA?: string
  auth?: AuthResponse
}

// ============ DTOs de request (opcional) ============
export interface LoginEmpleadoInput {
  email: string
  pin: string
}

export interface RegistrarClienteInput {
  nombre: string
  telefono: string
  email?: string
  fechaNacimiento?: Date
}

export interface SolicitarVisitaInput {
  clienteId: string
  tipo: TipoVisita
  metodo: MetodoVisita
}

export interface AprobarVisitaInput {
  visitaId: string
  empleadoId: string
  observaciones?: string
}

export interface CrearItemCartaInput {
  nombre: string
  descripcion?: string
  precio: number
  categoria: string
  imagenUrl?: string
}

export interface EnviarPromocionInput {
  nombre: string
  mensaje: string
  canal: CanalCampana
  destinatarios: 'TODOS' | 'ETIQUETA' | 'INDIVIDUAL'
  filtroEtiqueta?: EtiquetaCliente
  clienteIds?: string[]
  programadaPara?: Date
}
