import { randomBytes } from 'crypto';
import type { TipoPremio } from '@prisma/client';

/**
 * Descriptor del premio configurable en un disparo o una campaña de push.
 *
 *   { tipo:'SELLOS', cantidad:2, texto:'2 sellos extra' }
 *   { tipo:'PUNTOS', cantidad:50, texto:'50 puntos' }
 *   { tipo:'LIBRE',  texto:'un postre gratis' }        // NO mueve saldo
 *   { tipo:'SELLOS', cantidad:1, texto:'...', expiraDias:7 }
 *
 * Viene del JSON `premio` de `DisparoPush`/`CampanaPush`; `leerPremio` lo normaliza
 * (nunca confia en el shape) y devuelve `null` si el disparo/campaña NO tiene premio.
 */
export interface DescriptorPremio {
  tipo: TipoPremio;
  /** Cuanto acredita al aceptar (SELLOS/PUNTOS). 0 en LIBRE. */
  cantidad: number;
  /** Texto que ve el cliente y el staff (ej. "un postre gratis"). */
  texto: string;
  /** Dias de vigencia desde el otorgamiento. `null` = no vence. */
  expiraDias: number | null;
}

const TIPOS: readonly TipoPremio[] = ['SELLOS', 'PUNTOS', 'LIBRE'];

/**
 * Normaliza el JSON `premio`. Devuelve `null` si no hay premio o el `tipo` es
 * invalido (asi un disparo con `premio` basura sigue funcionando como uno sin premio,
 * en vez de romper el motor).
 */
export function leerPremio(valor: unknown): DescriptorPremio | null {
  const o = (valor ?? {}) as { tipo?: unknown; cantidad?: unknown; texto?: unknown; expiraDias?: unknown };
  const tipo = typeof o.tipo === 'string' && TIPOS.includes(o.tipo as TipoPremio) ? (o.tipo as TipoPremio) : null;
  if (!tipo) return null;

  const n = Math.max(0, Math.floor(Number(o.cantidad ?? (tipo === 'LIBRE' ? 0 : 1)))) || 0;
  // LIBRE nunca acredita; SELLOS/PUNTOS con cantidad 0 se tratan como 1 (regalar 0 no tiene sentido).
  const cantidad = tipo === 'LIBRE' ? 0 : Math.max(1, n);
  const texto = typeof o.texto === 'string' && o.texto.trim() ? o.texto.trim().slice(0, 140) : textoPorTipo(tipo, cantidad);
  const expiraDias = Math.max(0, Math.floor(Number(o.expiraDias ?? 0))) || null;
  return { tipo, cantidad, texto, expiraDias };
}

/** Texto por defecto del premio cuando el admin no lo escribe. */
export function textoPorTipo(tipo: TipoPremio, cantidad: number): string {
  if (tipo === 'SELLOS') return `${cantidad} ${cantidad === 1 ? 'sello' : 'sellos'} de regalo`;
  if (tipo === 'PUNTOS') return `${cantidad} ${cantidad === 1 ? 'punto' : 'puntos'} de regalo`;
  return 'un premio de regalo';
}

/** Token OPACO del premio: 24 bytes (192 bits) en base64url. No adivinable. */
export function generarTokenPremio(): string {
  return randomBytes(24).toString('base64url');
}

/** `Date` de vencimiento a partir de los dias de vigencia. `null` = no vence. */
export function expiraDe(dias: number | null, desde: Date = new Date()): Date | null {
  if (!dias || dias <= 0) return null;
  return new Date(desde.getTime() + dias * 86_400_000);
}

/** Vencimiento en texto para la UI (fecha + hora corta, hora local del server AR). */
export function vencimientoLegible(fecha: Date | null): string | null {
  if (!fecha) return null;
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}
