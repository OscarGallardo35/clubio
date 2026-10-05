import { TipoTurno } from '@prisma/client';

export interface TurnoSemanal {
  id: string;
  empleadoId: string;
  empleadoNombre: string;
  sucursalId: string;
  horaInicio: string;
  horaFin: string;
  tipoTurno: TipoTurno;
  notas: string | null;
}

export interface DiaSemanal {
  fecha: string;
  diaSemana: string;
  turnos: TurnoSemanal[];
  encargado: { empleadoId: string; nombre: string } | null;
}