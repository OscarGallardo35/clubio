/**
 * Constantes del tenant de la PWA Admin.
 *
 * `NEXT_PUBLIC_DEFAULT_TENANT` es el slug del seed: se usa para los redirects de compatibilidad de
 * las URLs viejas (sin slug) y como ultimo fallback. En cuanto haya 2+ locales el valor por defecto
 * deja de tener sentido: la URL siempre lleva el tenant.
 */
export const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'bar-la-esquina';

/** Ruta de login dentro de cada tenant (`/<tenant>/login`). */
export const RUTA_LOGIN = '/login';

/** A donde entra el dueno despues del login (y el default de la raiz del tenant). */
export const RUTA_INICIO = '/dashboard';
