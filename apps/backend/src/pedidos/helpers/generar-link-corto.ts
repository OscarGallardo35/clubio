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

/** URL que abre el atendiente en la PWA Staff. */
export function construirUrlCorta(linkToken: string): string {
  const base = (process.env.STAFF_APP_URL ?? 'https://staff.dominio.com').replace(/\/$/, '');
  return `${base}/pedido/${linkToken}`;
}

/** ¿El link ya vencio? */
export function linkVencido(linkExpiraEn: Date | null | undefined): boolean {
  return !!linkExpiraEn && linkExpiraEn.getTime() < Date.now();
}