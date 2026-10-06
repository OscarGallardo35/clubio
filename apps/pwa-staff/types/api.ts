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
