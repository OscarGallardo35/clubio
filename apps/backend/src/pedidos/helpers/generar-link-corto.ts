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

/**
 * URL de seguimiento del CLIENTE: PUBLIC_APP_URL + slug del negocio.
 *
 * No confundir con `construirUrlCorta`, que es la del staff (STAFF_APP_URL): mezclarlas manda al
 * cliente al dominio del staff, donde la ruta /pedido/:token no existe y recibe un 404.
 */
export function construirUrlCliente(linkToken: string, slugNegocio: string): string {
  const base = (process.env.PUBLIC_APP_URL ?? 'https://app.dominio.com').replace(/\/$/, '');
  return `${base}/${slugNegocio}/pedido/${linkToken}`;
}

/** ¿El link ya vencio? */
export function linkVencido(linkExpiraEn: Date | null | undefined): boolean {
  return !!linkExpiraEn && linkExpiraEn.getTime() < Date.now();
}