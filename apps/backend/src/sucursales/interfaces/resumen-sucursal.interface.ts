import { Sucursal } from '@prisma/client';

/** Sucursal con metricas agregadas (listado del dueno). */
export interface ResumenSucursal {
  id: string;
  nombre: string;
  slug: string;
  direccion: string | null;
  telefono: string | null;
  numeroAtendiente: string | null;
  activa: boolean;
  esPrincipal: boolean;
  colorPrimario: string | null;
  colorSecundario: string | null;
  creadoEn: Date;
  empleadosActivos: number;
  clientesRegistrados: number;
  pedidosDelMes: number;
  visitasDelMes: number;
  tieneConfiguracionOverride: boolean;
}

export interface EmpleadoBasico {
  id: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

export interface SucursalDetalle extends Sucursal {
  configuracion: unknown | null;
  empleados: EmpleadoBasico[];
  estadisticas: {
    empleadosActivos: number;
    clientesRegistrados: number;
    pedidosDelMes: number;
    visitasDelMes: number;
    pedidosActivos: number;
  };
}

export interface ResultadoEliminar {
  ok: boolean;
  sucursalId: string;
  empleadosReasignados?: number;
  pedidosCancelados?: number;
}