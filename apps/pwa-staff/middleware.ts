import { NextResponse, type NextRequest } from 'next/server';

/**
 * Guard de rutas de la PWA Staff.
 *
 * Chequea la PRESENCIA de la cookie `empleado_token`, no su validez: la cookie es
 * HttpOnly y el middleware no puede verificarla (verificarla requiere la DB). La
 * validez la resuelve `useEmpleado` con GET /auth/empleado/me, y un 401 ahi limpia
 * la sesion y vuelve a /login.
 *
 * Reparto de responsabilidades: el middleware evita el flash de "dashboard sin
 * sesion"; el hook es la fuente de verdad.
 *
 * El filtro de archivos estaticos va ACA y no en `matcher`: un `.*\..*` dentro del
 * matcher hace que Next descarte el middleware ENTERO sin avisar (verificado: sin
 * el, la cabecera de prueba no aparecia en ninguna respuesta).
 */
const COOKIE_SESION = 'empleado_token';
const RUTAS_PUBLICAS = ['/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Assets con extension (.png, .json, .ico, ...) y las rutas internas de Next no
  // pasan por el guard.
  if (pathname.startsWith('/_next') || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next();
  }

  const tieneCookie = Boolean(req.cookies.get(COOKIE_SESION)?.value);
  const esPublica = RUTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!tieneCookie && !esPublica) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Se guarda a donde iba (CON query) para volver despues del login: sin el
    // search, el link del WhatsApp (`/validar?ref=TOKEN`) perderia el token al
    // pasar por /login.
    const destino = `${pathname}${req.nextUrl.search}`;
    url.search = pathname === '/' ? '' : `?volver=${encodeURIComponent(destino)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Matcher MINIMO (el ejemplo de la doc de Next). Sin `.*\..*` ni grupos raros:
  // el filtro fino de archivos estaticos esta en el codigo, que se lee y se testea.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
