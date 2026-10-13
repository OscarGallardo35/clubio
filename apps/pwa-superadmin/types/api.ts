/**
 * Tipos de la API del panel de plataforma.
 *
 * Se declaran aca (y no en `@repo/types`) porque son del panel: `@repo/types` es el
 * contrato compartido con el backend y las otras PWAs, y ningun otro consumidor los usa.
 *
 * El theme SI se importa de `@repo/types`: su forma (colores + sello + fondo + puntos) la
 * define la tarjeta del cliente, y una copia estructural mas en este panel se
 * desincronizaria al primer campo nuevo.
 */
import type { TenantTheme } from '@repo/types';

/** Respuesta de `GET /api/superadmin/auth/me`. */
export interface SuperAdminSesion {
  tipo: 'SUPERADMIN';
  superadmin: {
    id: string;
    email: string;
    nombre: string;
    twoFactorEnabled: boolean;
    ultimoAcceso: string | null;
  };
}

/**
 * Respuesta del login / del paso de 2FA.
 *
 * Es una union laxa porque el PRIMER paso con 2FA activo NO emite sesion: llega
 * `{ requiere2FA: true, challengeToken }` y sin `accessToken`. El segundo paso (o un
 * login sin 2FA) SI trae la sesion.
 */
export interface LoginSuperAdminRespuesta {
  requiere2FA?: boolean;
  challengeToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  superadmin?: { id: string; email: string; nombre: string };
}

/** Los planes de facturacion de Prisma (`Plan`). */
export type PlanLocal = 'FREE' | 'BASIC' | 'PRO';
export const PLANES: PlanLocal[] = ['FREE', 'BASIC', 'PRO'];

/** Un local de la plataforma como lo devuelve `GET /api/superadmin/locales`. */
export interface LocalPlataforma {
  id: string;
  nombre: string;
  slug: string;
  plan: PlanLocal;
  activo: boolean;
  /** `theme` JSON presente: la tarjeta del cliente tiene diseno personalizado. */
  tieneTheme: boolean;
  creadoEn: string;
  sucursales: number;
  empleados: number;
  clientes: number;
}

export interface LocalesRespuesta {
  total: number;
  data: LocalPlataforma[];
}

/** `GET /api/superadmin/resumen`: metricas basicas de la plataforma. */
export interface ResumenPlataforma {
  locales: { total: number; activos: number; inactivos: number; conTheme: number };
  porPlan: { plan: string; total: number }[];
}

/* ------------------------------------------------------------------ *
 * Detalle de un local
 * ------------------------------------------------------------------ */

/** Modos de fidelizacion (enum `ModoFidelizacion` de Prisma). */
export type ModoFidelizacion = 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO';
export const MODOS_FIDELIZACION: ModoFidelizacion[] = ['SOLO_VISITAS', 'SOLO_PUNTOS', 'HIBRIDO'];

/**
 * Los campos del club que edita el panel de plataforma.
 *
 * Es un subconjunto de `ConfiguracionClub`: el operador arma la config que hace funcionar
 * la demo, no la operacion diaria (pagos, turnos y pedidos son del dueno). Los campos que
 * devuelva el backend y aca no se nombren se conservan igual (`[k: string]: unknown`).
 */
export interface ConfiguracionLocal {
  modoFidelizacion: ModoFidelizacion;
  sellosParaPremio: number;
  premioTexto: string;
  numeroAtendiente?: string | null;
  sellosBienvenida?: number;
  limiteVisitasPorDia?: number;
  horasMinimasEntreVisitas?: number;
  requiereValidacionEmpleado?: boolean;
  [k: string]: unknown;
}

/** Contadores del local (items de carta, empleados) que trae el detalle. */
export interface ContadoresLocal {
  itemsCarta: number | null;
  empleados: number | null;
  clientes?: number | null;
  visitas?: number | null;
  pedidos?: number | null;
  sucursales?: number | null;
}

/**
 * `GET /api/superadmin/locales/:negocioId`: el local con su config, su theme y sus contadores.
 *
 * Varios campos son opcionales/nullable a proposito: el panel tiene que renderizar un local a
 * medio configurar (sin configuracion, sin theme, sin sucursal principal) sin romperse.
 */
export interface LocalDetalle {
  id: string;
  nombre: string;
  slug: string;
  plan: PlanLocal;
  activo: boolean;
  colorPrimario: string;
  colorSecundario: string;
  telefono?: string | null;
  email?: string | null;
  numeroAtendiente?: string | null;
  creadoEn?: string | null;
  tieneTheme?: boolean;
  theme?: TenantTheme | null;
  configuracion?: ConfiguracionLocal | null;
  contadores?: ContadoresLocal | null;
}

/** Body de `POST /api/superadmin/locales` y de `PATCH .../:negocioId`. */
export interface DatosLocalBody {
  nombre?: string;
  slug?: string;
  plan?: PlanLocal;
  /**
   * Los colores y el telefono aceptan `null` EXPLICITO: el contrato nuevo del backend lo
   * interpreta como "borra el valor" (el campo vacio significa "no tocar").
   */
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  numeroAtendiente?: string | null;
  telefono?: string | null;
  email?: string | null;
  activo?: boolean;
}

/* ------------------------------------------------------------------ *
 * La fabrica (provisionar)
 * ------------------------------------------------------------------ */

export type PlantillaDemo = 'lomiteria' | 'bar' | 'cafeteria' | 'basica';

/** Lo que el backend informa que quedo creado al provisionar. */
export interface ResultadoProvision {
  ok?: boolean;
  yaExistia?: boolean;
  /** Contadores REALES de lo creado: el panel no los estima, los lee de aca. */
  creado?: {
    itemsCarta?: number;
    empleados?: number;
    clientes?: number;
    sucursales?: number;
    [k: string]: unknown;
  };
  /**
   * Items que la plantilla BORRO de la carta (solo con `reemplazarCarta: true`). El panel lo
   * muestra tal cual: es el dato que explica que se perdio al reemplazar la carta.
   */
  cartaBorrados?: number;
  mensaje?: string;
  [k: string]: unknown;
}

export interface ResultadoResetDemo {
  ok?: boolean;
  mensaje?: string;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ *
 * Carta
 * ------------------------------------------------------------------ */

export interface ItemCartaLocal {
  id: string;
  nombre: string;
  /** Prisma serializa Decimal como string ("1500.00"): se normaliza al mostrar y al editar. */
  precio: string | number;
  descripcion?: string | null;
  disponible: boolean;
  /** Campo de agrupacion. El contrato lo llama "grupo/categoria"; el modelo, `categoria`. */
  categoria: string;
  orden?: number;
  /** Foto del item (URL de Cloudinary). Null/vacio = sin foto. */
  fotoUrl?: string | null;
  [k: string]: unknown;
}

export interface ItemCartaBody {
  nombre: string;
  precio: number;
  categoria: string;
  descripcion?: string;
  disponible?: boolean;
  /** URL de Cloudinary que devolvio la subida firmada. */
  fotoUrl?: string;
}

/* ------------------------------------------------------------------ *
 * Plan y features del local (pestana Plan)
 * ------------------------------------------------------------------ */

/**
 * El contrato lo define `@repo/api-client` (lo comparte el backend) y el panel lo re-exporta:
 * duplicar la forma aca se desincronizaria al primer campo nuevo.
 *
 * - `FeatureCatalogo`   -> `GET /superadmin/features` (clave/etiqueta/descripcion + `tipo` +
 *                          `planesIncluidos` y `limitesPorPlan`, calculados contra PlanFeature).
 * - `EstadoPlanNegocio` -> `GET/PATCH /superadmin/locales/:id/plan`.
 * - `CambioFeaturePlan` / `ActualizarPlanNegocioBody` -> body del PATCH.
 */
export type {
  FeatureCatalogo,
  FeatureEstado,
  EstadoPlanNegocio,
  CambioFeaturePlan,
  ActualizarPlanNegocioBody,
} from '@repo/api-client';

/* ------------------------------------------------------------------ *
 * Empleados
 * ------------------------------------------------------------------ */

export type RolEmpleado = 'DUENO' | 'ENCARGADO' | 'CAJERO' | 'MESERO' | 'DELIVERY' | 'EMPLEADO';
export const ROLES: RolEmpleado[] = [
  'DUENO',
  'ENCARGADO',
  'CAJERO',
  'MESERO',
  'DELIVERY',
  'EMPLEADO',
];

export interface EmpleadoLocal {
  id: string;
  nombre: string;
  rol: RolEmpleado;
  email?: string | null;
  /** El backend NUNCA devuelve el PIN ni la password: solo si los tiene. */
  tienePin: boolean;
  activo?: boolean;
  creadoEn?: string | null;
  [k: string]: unknown;
}

/**
 * Alta de empleado. Se manda UNO de los dos caminos:
 *  - `pin` (entra desde el panel del staff, en el celular del local), o
 *  - `email` + `password` (entra desde el panel del dueno).
 * La password NUNCA se vuelve a mostrar: el backend guarda el hash.
 */
export interface EmpleadoBody {
  nombre: string;
  rol: RolEmpleado;
  email?: string;
  password?: string;
  pin?: string;
  activo?: boolean;
}
