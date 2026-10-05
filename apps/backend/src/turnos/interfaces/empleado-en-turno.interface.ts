import { TipoTurno } from '@prisma/client';

/** Empleado con turno vigente (lo consume el motor de asignacion). */
export interface EmpleadoEnTurno {
  empleadoId: string;
  nombre: string;
  rol: string;
  tipoTurno: TipoTurno;
  sucursalId: string;
  horaInicio: string;
  horaFin: string;
  turnoId: string;
  hizoCheckin: boolean;
}

/** Resultado del motor de asignacion. */
export interface Destinatarios {
  empleadosNotificados: string[];
  empleadoAsignado: string | null;
  encargadoId: string | null;
  modoEfectivo: string;
  /** Explicacion del camino tomado (util para depurar y para los tests). */
  motivo: string;
}