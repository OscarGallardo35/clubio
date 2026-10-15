import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de PERFILADO PROGRESIVO compartidas por los dos caminos que escriben fecha de
 * nacimiento / genero: el cliente desde su PWA (`PATCH /auth/cliente/perfil`) y el dueno
 * desde el panel (`POST|PATCH /clientes`). La validacion vive aca y NO en el DTO porque
 * tiene que correr igual en los dos lados (y un DTO de class-validator no puede mirar
 * "cuantos años tiene" sin repetir la logica).
 *
 * Ley 25.326 (Argentina): los datos sensibles de menores de 13 años no se pueden tratar
 * (art. 7). El consentimiento tiene que poder probarse, por eso se guarda la version del
 * texto aceptado (`consentimientoPerfilVer`).
 */

/** Version del texto de consentimiento que el cliente acepta al guardar sus datos. */
export const CONSENTIMIENTO_PERFIL_VERSION = 'v1-2026-10';

/** Edad minima para tratar datos de perfilado (art. 7, Ley 25.326). */
export const EDAD_MINIMA_PERFIL = 13;

/** Tope de cordura: mas de 100 años no es un dato real. */
export const EDAD_MAXIMA_PERFIL = 100;

/** `null`/`''` = BORRAR el dato (el valor queda en null). */
export type FechaNacimientoEntrada = string | null | undefined;

/**
 * Normaliza y valida una fecha de nacimiento.
 *
 * - `null` (o `''`) = borrar: devuelve `null` sin validar nada mas.
 * - Acepta `YYYY-MM-DD` (lo que manda un `<input type="date">`) y, como fallback, cualquier
 *   string que `Date` sepa parsear (ISO con hora, etc.).
 * - 400 si es invalida, futura, de hace mas de 100 años, o si implica menos de 13 años.
 *   Las fechas se comparan contra HOY en UTC: una fecha de nacimiento es un dia de
 *   calendario, no un instante, y comparar en UTC evita el off-by-one de la zona AR.
 */
export function parseFechaNacimientoPerfil(valor: FechaNacimientoEntrada): Date | null {
  if (valor === null || valor === undefined) return null;

  const texto = String(valor).trim();
  if (texto === '') return null;

  const fecha = parsearFecha(texto);
  if (!fecha) throw new BadRequestException('La fecha de nacimiento no es valida');

  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);

  if (fecha.getTime() > hoy.getTime()) {
    throw new BadRequestException('La fecha de nacimiento no puede ser futura');
  }

  const haceMax = new Date(hoy);
  haceMax.setUTCFullYear(hoy.getUTCFullYear() - EDAD_MAXIMA_PERFIL);
  if (fecha.getTime() < haceMax.getTime()) {
    throw new BadRequestException(
      `La fecha de nacimiento no puede tener mas de ${EDAD_MAXIMA_PERFIL} años`,
    );
  }

  const haceMin = new Date(hoy);
  haceMin.setUTCFullYear(hoy.getUTCFullYear() - EDAD_MINIMA_PERFIL);
  if (fecha.getTime() > haceMin.getTime()) {
    throw new BadRequestException(
      `Tenes que tener al menos ${EDAD_MINIMA_PERFIL} años para cargar estos datos`,
    );
  }

  return fecha;
}

/** `YYYY-MM-DD` estricto (sin rollover: 2026-02-30 es invalida) o lo que parsee `Date`. */
function parsearFecha(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (m) {
    const anio = Number(m[1]);
    const mes = Number(m[2]);
    const dia = Number(m[3]);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    const esLaMisma =
      fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
    if (!esLaMisma) return null;
    if (fecha.getTime() > 0 && anio < 1000) return null;
    return fecha;
  }
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
