import { randomBytes } from 'crypto';

/** 128 bits de entropia -> 32 caracteres hex. */
export const BYTES_LINK = 16;
export const HORAS_EXPIRACION = 4;

export function generarLinkToken(): string {
  return randomBytes(BYTES_LINK).toString('hex'); // 128 bits
}

export function calcularExpiracion(horas = HORAS_EXPIRACION): Date {
  return new Date(Date.now() + horas * 3_600_000);
}

/**
 * URL que abre el atendiente en la PWA Staff.
 *
 * Apunta a `/validar-pedido?ref=TOKEN` (una pantalla del staff que resuelve el linkToken y
 * entra al detalle del pedido). Antes apuntaba a `/pedido/TOKEN`, una ruta que NO existe en
 * la PWA Staff: el staff hacia click y comia un "This page could not be found".
 */
export function construirUrlCorta(linkToken: string): string {
  const base = (process.env.STAFF_APP_URL ?? 'https://staff.dominio.com').replace(/\/$/, '');
  return `${base}/validar-pedido?ref=${linkToken}`;
}

/** ¿El link ya vencio? */
export function linkVencido(linkExpiraEn: Date | null | undefined): boolean {
  return !!linkExpiraEn && linkExpiraEn.getTime() < Date.now();
}