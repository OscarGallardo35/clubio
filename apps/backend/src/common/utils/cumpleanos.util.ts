/**
 * LOGICA PURA del disparo de CUMPLEANOS (fase 2 del perfilado progresivo).
 *
 * Vive en `common/utils` y NO dentro de `DisparosService` por dos motivos:
 *  1. se puede testear sin DB ni reloj (todas las funciones reciben la fecha por parametro);
 *  2. `push.service` (segmento CUMPLEANOS_MES / variable `{{edad}}`) la necesita y NO puede
 *     importar `disparos.service` (ese ya importa `push.service`: seria el import circular
 *     que una vez impidio arrancar el backend).
 *
 * `Cliente.fechaNacimiento` es un DIA DE CALENDARIO guardado a las 00:00 UTC
 * (`Date.UTC(anio, mes-1, dia)`): se lee con los getters UTC, igual que hace
 * `parseFechaNacimientoPerfil`. La hora argentina es UTC-3 TODO el anio (sin DST).
 */

/** Argentina es UTC-3 todo el anio. */
export const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

/** Anio/mes(1..12)/dia de una fecha de calendario. */
export interface FechaAR {
  y: number;
  m: number;
  d: number;
}

/** "Hoy" en hora ARGENTINA, derivado de un `Date` UTC sin depender de la TZ del proceso. */
export function fechaARDe(base: Date = new Date()): FechaAR {
  const ar = new Date(base.getTime() - OFFSET_AR_MS);
  return { y: ar.getUTCFullYear(), m: ar.getUTCMonth() + 1, d: ar.getUTCDate() };
}

/** Un anio es bisiesto si es divisible por 4, salvo los siglos que no son divisibles por 400. */
export function esAnioBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** `diasAntes` acotado a [0,7]; cualquier valor raro (NaN, negativo, >7) cae dentro. */
export function clampDiasAntes(valor: unknown): number {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 7 ? 7 : n;
}

/**
 * (mes, dia) EFECTIVO del cumpleanos en `anio`.
 *
 * REGLA 29/02 (documentada y probada): si el cliente nacio un 29 de febrero y `anio`
 * NO es bisiesto (el 29/02 no existe), el saludo sale el 28/02 — la convencion de
 * celebrar el ultimo dia de febrero. En un anio bisiesto sale el 29/02.
 */
export function cumpleEfectivo(fechaNacimiento: Date, anio: number): { mes: number; dia: number } {
  const mes = fechaNacimiento.getUTCMonth() + 1;
  const dia = fechaNacimiento.getUTCDate();
  if (mes === 2 && dia === 29 && !esAnioBisiesto(anio)) return { mes: 2, dia: 28 };
  return { mes, dia };
}

/** Fecha de calendario del OBJETIVO: hoy + `diasAntes` (normalizada por `Date`, no por strings). */
function objetivo(hoy: FechaAR, diasAntes: number): Date {
  return new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d) + clampDiasAntes(diasAntes) * 86_400_000);
}

/**
 * true si a este cliente le toca el saludo HOY.
 *
 * El saludo sale `diasAntes` dias ANTES del cumpleanos: el objetivo es `hoy + diasAntes`
 * (en fecha de calendario AR) y matchea si el (mes, dia) efectivo del cliente coincide con
 * el del objetivo. Se compara por fecha NORMALIZADA (Date + N dias), NO por strings `MM-DD`,
 * asi el cruce de anio funciona: un cliente que cumple el 1/1, con `diasAntes = 3`, se
 * saluda el 29/12 del anio anterior.
 *
 * Un cliente SIN `fechaNacimiento` NUNCA entra (filtra el null/undefined de entrada).
 */
export function cumpleElDiaObjetivo(
  fechaNacimiento: Date | null | undefined,
  hoy: FechaAR,
  diasAntes: number,
): boolean {
  if (!fechaNacimiento) return false;
  const dest = objetivo(hoy, diasAntes);
  const { mes, dia } = cumpleEfectivo(fechaNacimiento, dest.getUTCFullYear());
  return mes === dest.getUTCMonth() + 1 && dia === dest.getUTCDate();
}

/**
 * Anio del cumpleanos al que apunta el saludo (el del objetivo `hoy + diasAntes`).
 * Es la `<anioAR>` de la clave de dedupe `CUMPLEANOS:<clienteId>:<anioAR>`: "una vez por anio",
 * sin repetir en los otros 364 dias. Usa el anio del OBJETIVO (no el de hoy) para que el
 * saludo adelantado del 29/12 comparta clave con el del 1/1 del mismo cumpleanos.
 */
export function anioObjetivo(hoy: FechaAR, diasAntes: number): number {
  return objetivo(hoy, diasAntes).getUTCFullYear();
}

/** Edad CUMPLIDA en AR a la fecha `hoy`. `null` si no hay fecha de nacimiento. */
export function edadALaFecha(
  fechaNacimiento: Date | null | undefined,
  hoy: FechaAR,
): number | null {
  if (!fechaNacimiento) return null;
  const { mes, dia } = cumpleEfectivo(fechaNacimiento, hoy.y);
  let edad = hoy.y - fechaNacimiento.getUTCFullYear();
  if (hoy.m < mes || (hoy.m === mes && hoy.d < dia)) edad -= 1;
  return edad;
}
