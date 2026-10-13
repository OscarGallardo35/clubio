import { ApiError } from '@repo/api-client';

/**
 * Normaliza un error de red/HTTP a (status, mensaje).
 *
 * Misma logica que en las otras PWAs: un fallo de red es un `TypeError` crudo y no
 * tiene status, asi que se sintetiza 0 (sin esto "sin internet" no se distingue de
 * "no hay sesion" y el panel te manda al login por un corte de wifi).
 */
export function normalizarError(e: unknown): { status: number; mensaje: string } {
  if (e instanceof ApiError) {
    return { status: e.status, mensaje: e.message || 'No pudimos completar la operacion' };
  }
  if (e instanceof Error) return { status: 0, mensaje: e.message };
  return { status: 0, mensaje: 'No pudimos conectar con el servidor' };
}

export const estadoDeError = (e: unknown) => normalizarError(e).status;
