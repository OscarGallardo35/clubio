import type {
  Cliente, Empleado, Negocio, Pedido, Sucursal, UsoMensual, Visita,
} from './entities';
import type { Plan, RolEmpleado } from './enums';

// ===== Auth =====

export interface AuthEmpleadoResponse {
  accessToken: string;
  expiresIn: number;
  empleado: { id: string; nombre: string; rol: RolEmpleado; sucursalId: string };
  negocio: { id: string; slug: string; nombre: string };
}

export interface AuthDuenoResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  empleado: { id: string; nombre: string; rol: RolEmpleado };
  negocio: { id: string; slug: string; nombre: string };
}

export interface Requiere2FAResponse {
  requiere2FA: true;
  challengeToken: string;
}

export interface AuthClienteResponse {
  accessToken: string;
  expiresIn: number;
  negocio: { id: string; slug: string };
  cliente: Pick<Cliente, 'id' | 'nombre' | 'telefono' | 'sellosActuales' | 'totalVisitas'>;
  recienCreado?: boolean;
}

export type LoginDuenoResponse = AuthDuenoResponse | Requiere2FAResponse;

// ===== Clientes / fidelizacion =====

export interface ClienteConSellos extends Cliente {
  progreso: { porcentaje: number; faltantes: number; completado: boolean };
  sucursal?: Sucursal;
}

export interface VisitaConEmpleado extends Visita {
  empleadoNombre?: string | null;
  clienteNombre: string;
}

export interface SolicitudPendiente {
  visitaId?: string;
  clienteId: string;
  clienteNombre: string;
  clienteTelefono: string;
  tipoVisita: string;
  fechaSolicitud: string;
  sellosOtorgados: number;
}

// ===== Dashboard =====

export interface DashboardKPIs {
  clientesTotales: number;
  clientesActivos: number;
  visitasHoy: number;
  visitasMes: number;
  promedioRating: number;
  pedidosPendientes: number;
  ingresosHoy: number;
  ingresosMes: number;
}

// ===== Carta / pedidos =====

export interface CalcularTotalesResponse {
  subtotal: number;
  costoEnvio: number;
  total: number;
  items: Array<{ itemId: string; nombre: string; cantidad: number; precioUnitario: number; subtotal: number }>;
}

export interface PedidoPublicoResponse {
  pedido: Pedido;
  negocio: Pick<Negocio, 'id' | 'nombre' | 'slug'>;
  sucursal: Pick<Sucursal, 'id' | 'nombre'>;
}

export interface UpsellSugerencia {
  itemDestinoId: string;
  nombre: string;
  mensaje: string;
  prioridad: number;
}

// ===== Plan / limites =====

export interface MiPlanResponse {
  plan: Plan;
  uso: UsoMensual[];
}

// ===== Sucursales =====

export interface SucursalConStats extends Sucursal {
  stats: { clientes: number; visitas: number; pedidos: number; ingresos: number };
}

// ===== Genericos =====

/**
 * Formato UNICO de todas las respuestas de listado de la API.
 * Refinamiento: { data, total, page, pageSize }
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  redis: 'up' | 'down';
  timestamp: string;
}

// ===== Empleados =====

export interface EmpleadoConTurno extends Empleado {
  enTurno?: boolean;
  checkinEn?: string | null;
}
