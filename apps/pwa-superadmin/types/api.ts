/**
 * Tipos de la API del panel de plataforma.
 *
 * Se declaran aca (y no en `@repo/types`) porque son del panel: `@repo/types` es el
 * contrato compartido con el backend y las otras PWAs, y ningun otro consumidor los usa.
 */

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

/** Un local de la plataforma como lo devuelve `GET /api/superadmin/locales`. */
export interface LocalPlataforma {
  id: string;
  nombre: string;
  slug: string;
  plan: 'FREE' | 'BASIC' | 'PRO';
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
