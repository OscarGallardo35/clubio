/**
 * Constantes de navegacion del panel de plataforma.
 *
 * No hay `DEFAULT_TENANT`: este panel no es multi-tenant. Sus rutas son planas.
 */

/** Ruta del login (tambien el healthcheck del servicio: devuelve 200 sin cookie). */
export const RUTA_LOGIN = '/login';

/** A donde entra el operador despues del login (y default de la raiz). */
export const RUTA_INICIO = '/locales';
