
import { Transform } from 'class-transformer';

/**
 * Transforma un query param booleano.
 *
 * OJO con dos trampas:
 *   - Todo lo que llega por @Query() es STRING, asi que `?force=true` no pasa un
 *     @IsBoolean() (devuelve 400 "force must be a boolean value").
 *   - `@Type(() => Boolean)` NO sirve: Boolean("false") === true, asi que
 *     `?activa=false` filtraria por activa=true. Hay que comparar el texto.
 *
 * Acepta: true/false, 1/0, "true"/"false", "1"/"0", "si"/"no".
 */
export const QueryBool = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).trim().toLowerCase();
    if (['true', '1', 'si', 'sí'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return value; // deja pasar el valor raro para que @IsBoolean() lo rechace
  });
