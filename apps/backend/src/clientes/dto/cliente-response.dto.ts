import { EtiquetaCliente } from '@prisma/client';

/**
 * Dos contratos de respuesta segun el rol que consulta (aprobado por el usuario).
 *
 * El staff necesita verificar la tarjeta del cliente al atender (cajero cobra,
 * mesero atiende, cadete entrega), pero NO debe ver datos sensibles.
 */

/** Roles que ven el cliente completo. */
export const ROLES_PRIVILEGIADOS: string[] = ['DUENO', 'ENCARGADO'];

export function esRolPrivilegiado(rol: string | undefined | null): boolean {
  return !!rol && ROLES_PRIVILEGIADOS.includes(rol);
}

/** Tarjeta de una sucursal (modoClientes = POR_SUCURSAL). */
export interface TarjetaSucursalResponse {
  sucursalId: string;
  sucursalNombre?: string;
  sucursalSlug?: string;
  esPrincipal?: boolean;
  sellosActuales: number;
  puntosActuales: number;
  totalVisitas: number;
}

/** Vista COMPLETA: DUENO / ENCARGADO. */
export interface ClienteResponseAdmin {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  etiqueta: EtiquetaCliente;
  sellosActuales: number;
  puntosActuales: number;
  totalVisitas: number;
  premiosCanjeados: number;
  ultimaVisita: Date | null;
  creadoEn: Date;
  notasInternas: string | null;
  fechaNacimiento: Date | null;
  aceptaNotificaciones: boolean;
  tarjetas?: TarjetaSucursalResponse[];
}

/** Vista REDUCIDA: CAJERO / MESERO / DELIVERY / EMPLEADO. */
export interface ClienteResponseStaff {
  id: string;
  nombre: string;
  /** Enmascarado: +549****8888 */
  telefono: string;
  etiqueta: EtiquetaCliente;
  sellosActuales: number;
  ultimaVisita: Date | null;
  tarjetas?: TarjetaSucursalResponse[];
}
