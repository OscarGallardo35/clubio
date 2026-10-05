import { BadRequestException } from '@nestjs/common';

/**
 * Normaliza un telefono a E.164 (ej: +5491112345678).
 *
 * Acepta:
 *  - E.164 ya normalizado:      +5491112345678
 *  - formato internacional 00:  005491112345678
 *  - movil local AR (10 digitos): 1112345678   -> +5491112345678
 *  - formato nacional con 0:    01112345678    -> +5491112345678
 *
 * Si no se puede normalizar a un E.164 valido, lanza 400.
 */
export function normalizarTelefonoE164(input: string, countryCode = '54'): string {
  const raw = (input ?? '').trim();
  if (!raw) {
    throw new BadRequestException('El telefono es obligatorio');
  }

  const teniaMas = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (!digits) {
    throw new BadRequestException(`Telefono invalido: "${input}"`);
  }

  // Prefijo internacional 00 -> se quita
  if (!teniaMas && digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  let e164: string;
  if (teniaMas) {
    e164 = `+${digits}`;
  } else if (digits.startsWith(countryCode)) {
    // Ya viene con codigo de pais (sin +)
    e164 = `+${digits}`;
  } else if (digits.startsWith('0')) {
    // Formato nacional 0<area><numero>
    e164 = `+${countryCode}9${digits.slice(1)}`;
  } else if (digits.length === 10) {
    // Movil local AR de 10 digitos
    e164 = `+${countryCode}9${digits}`;
  } else {
    e164 = `+${digits}`;
  }

  // E.164: '+' y entre 8 y 15 digitos
  if (!/^\+\d{8,15}$/.test(e164)) {
    throw new BadRequestException(
      `Telefono invalido: "${input}". Usa formato E.164, ej: +5491112345678`,
    );
  }

  return e164;
}
