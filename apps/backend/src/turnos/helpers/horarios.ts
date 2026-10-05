import { BadRequestException } from '@nestjs/common';

/** "HH:mm" de 00:00 a 23:59 (con cero a la izquierda). */
export const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const MINUTOS_DIA = 1440;

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:mm" de una fecha (hora local del server). */
export function horaActual(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function validarRangoHoras(horaInicio: string, horaFin: string) {
  if (!REGEX_HORA.test(horaInicio) || !REGEX_HORA.test(horaFin)) {
    throw new BadRequestException('Las horas deben tener formato HH:mm (ej: 09:00)');
  }
  if (horaInicio === horaFin) {
    throw new BadRequestException('horaInicio y horaFin no pueden ser iguales');
  }
  // horaInicio > horaFin es VALIDO: turno que cruza medianoche (22:00 -> 02:00)
}

/**
 * Expande una franja a intervalos en minutos dentro del dia.
 * Un turno que cruza medianoche (22:00-02:00) se parte en [1320,1440] y [0,120].
 */
function intervalos(horaInicio: string, horaFin: string): Array<[number, number]> {
  const a = aMinutos(horaInicio);
  const b = aMinutos(horaFin);
  if (a < b) return [[a, b]];
  return [[a, MINUTOS_DIA], [0, b]]; // cruza medianoche
}

/**
 * ¿Los dos turnos se SOLAPAN? Compara tambien las versiones desplazadas +1440
 * para detectar el solapamiento cuando uno (o los dos) cruza medianoche.
 *
 * El unique de la DB ([negocioId, empleadoId, fecha, horaInicio]) NO alcanza:
 * 18:00-23:00 y 20:00-22:00 tienen distinto horaInicio y pasarian.
 */
export function franjasSeSolapan(
  aInicio: string, aFin: string, bInicio: string, bFin: string,
): boolean {
  const A = intervalos(aInicio, aFin);
  const B = intervalos(bInicio, bFin);
  const desplazar = (arr: Array<[number, number]>, d: number) =>
    arr.map(([x, y]) => [x + d, y + d] as [number, number]);

  for (const a of [...A, ...desplazar(A, MINUTOS_DIA)]) {
    for (const b of [...B, ...desplazar(B, MINUTOS_DIA)]) {
      if (a[0] < b[1] && b[0] < a[1]) return true;
    }
  }
  return false;
}

/**
 * ¿`ahora` cae dentro del turno? Soporta turnos que cruzan medianoche:
 * para 22:00-02:00 devuelve true a las 23:00 Y a las 01:00.
 */
export function enTurnoAhora(horaInicio: string, horaFin: string, ahora = horaActual()): boolean {
  const n = aMinutos(ahora);
  const a = aMinutos(horaInicio);
  const b = aMinutos(horaFin);
  if (a < b) return n >= a && n <= b;
  return n >= a || n <= b; // cruza medianoche
}

/** Fecha (YYYY-MM-DD) a medianoche UTC, como la guarda Prisma en @db.Date. */
export function fechaSoloDia(fecha: string | Date): Date {
  if (fecha instanceof Date) {
    return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new BadRequestException(`Fecha invalida: "${fecha}". Usa YYYY-MM-DD`);
  }
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Suma dias a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const d = fechaSoloDia(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha YYYY-MM-DD. */
export function lunesDe(fecha: string): string {
  const d = fechaSoloDia(fecha);
  const dow = d.getUTCDay(); // 0=domingo
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Hoy (YYYY-MM-DD) en hora local. */
export function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}