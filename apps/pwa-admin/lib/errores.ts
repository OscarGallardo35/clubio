import { ApiError } from '@repo/api-client';

/**
 * Normaliza un error de red/HTTP a (status, mensaje).
 *
 * - `ApiError` solo se lanza con un status real del backend.
 * - Un fallo de red es un `TypeError` crudo: no tiene status, asi que se
 *   sintetiza 0. Sin esto, "sin internet" no se puede distinguir de "no hay
 *   sesion" y la app te manda a /login por un corte de wifi.
 */
export function normalizarError(e: unknown): { status: number; mensaje: string } {
  if (e instanceof ApiError) {
    return { status: e.status, mensaje: e.message || 'No pudimos completar la operacion' };
  }
  if (e instanceof Error) return { status: 0, mensaje: e.message };
  return { status: 0, mensaje: 'No pudimos conectar con el servidor' };
}

export const estadoDeError = (e: unknown) => normalizarError(e).status;
