import type { CookieOptions } from 'express';

/**
 * Cookies de sesion (A1: HttpOnly).
 *
 * Decision de arquitectura (#3.0): el token viaja en una cookie HttpOnly en vez
 * de quedar en localStorage, que es accesible desde JS y por lo tanto robable con
 * un XSS. En produccion (dominios distintos, app.clubio.lat -> api.clubio.lat)
 * hace falta SameSite=None + Secure; en desarrollo, Lax sin Secure para que
 * funcione sobre http://localhost.
 *
 * SIMETRIA DELIBERADA: la PWA Staff usa el mismo mecanismo que la PWA Cliente
 * (`empleado_token`, mismas banderas, mismo path). Un solo patron de auth en el
 * repo. El header Bearer queda como fallback (harness de integracion y llamadas
 * server-to-server).
 *
 * Se puede forzar con COOKIE_SAMESITE / COOKIE_SECURE / COOKIE_DOMAIN.
 */
export const COOKIE_CLIENTE = 'cliente_token';

/** Cookie de sesion del STAFF (PWA Staff). Mismas banderas que la del cliente. */
export const COOKIE_EMPLEADO = 'empleado_token';

export function esProduccion(): boolean {
  return (process.env.NODE_ENV ?? 'development') === 'production';
}

/** Opciones de la cookie de sesion. Las MISMAS para cliente y staff: no hay
 * dos politicas de cookie que puedan divergir. */
export function opcionesCookieSesion(maxAgeSegundos: number): CookieOptions {
  const prod = esProduccion();

  const sameSite = (process.env.COOKIE_SAMESITE?.trim() ||
    (prod ? 'none' : 'lax')) as CookieOptions['sameSite'];
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE.trim() === 'true'
    : prod;

  const opciones: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: Math.max(0, Math.floor(maxAgeSegundos)) * 1000,
  };

  const dominio = process.env.COOKIE_DOMAIN?.trim();
  if (dominio) opciones.domain = dominio;

  return opciones;
}

/**
 * Opciones para BORRAR la cookie: mismas banderas pero sin maxAge (si no,
 * el navegador puede ignorar el clear).
 */
export function opcionesBorrarCookieSesion(): CookieOptions {
  const { maxAge: _maxAge, ...resto } = opcionesCookieSesion(0);
  return resto;
}

// Alias por contexto: se llaman igual que antes (nada que renombrar en los
// controllers) pero comparten una unica implementacion.
export const opcionesCookieCliente = opcionesCookieSesion;
export const opcionesCookieEmpleado = opcionesCookieSesion;
export const opcionesBorrarCookieCliente = opcionesBorrarCookieSesion;
export const opcionesBorrarCookieEmpleado = opcionesBorrarCookieSesion;

/**
 * Lee una cookie del header crudo `Cookie: a=1; b=2`.
 * Hace falta para el handshake del WebSocket: ahi no existe req.cookies.
 */
export function leerCookie(cookieHeader: string | undefined, nombre: string): string {
  if (!cookieHeader) return '';
  for (const parte of cookieHeader.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      return decodeURIComponent(parte.slice(i + 1).trim());
    }
  }
  return '';
}
