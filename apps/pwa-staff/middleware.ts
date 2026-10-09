import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_TENANT, RUTA_INICIO } from '@/lib/constants';
import { rutaLogin, slugDelToken, tenantDePath } from '@/lib/tenant';

/**
 * Guard de rutas Y de tenant de la PWA Staff.
 *
 * Cada pantalla vive bajo `/<tenant>/...`. El middleware hace tres cosas, en este orden:
 *
 * 1. **Sin tenant en la URL** (raiz o links viejos): manda al tenant por defecto. Los casos
 *    conocidos los cubren los `redirects` de `next.config.js`, que corren ANTES que esto; aca queda
 *    la red de seguridad para cualquier ruta no listada.
 * 2. **Sin cookie de sesion**: a `/<tenant>/login?volver=<destino>`. El `volver` conserva la query
 *    porque el link del WhatsApp (`/<tenant>/validar?ref=TOKEN`) no puede perder el token al pasar
 *    por el login.
 * 3. **Sesion de OTRO negocio**: si el token viene con un `negocioSlug` distinto al de la URL, se
 *    manda al slug del token. La cookie es HttpOnly y aca NO se verifica la firma (no hay secret en
 *    el edge, ni hace falta): se decodifica el payload y se compara. La barrera real es el backend,
 *    que resuelve el negocio del token en cada request; esto es UX, para no dejar a nadie parado en
 *    la UI de otro local.
 *
 * El filtro de archivos estaticos va ACA y no en `matcher`: un `.*\..*` dentro del matcher hace que
 * Next descarte el middleware ENTERO sin avisar (ver TROUBLESHOOTING).
 */
const COOKIE_SESION = 'empleado_token';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Assets con extension (.png, .json, .ico, ...) y las rutas internas de Next no pasan por el guard.
  if (pathname.startsWith('/_next') || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next();
  }

  const tenant = tenantDePath(pathname);

  if (!tenant) {
    const url = req.nextUrl.clone();
    url.pathname = `/${DEFAULT_TENANT}${pathname === '/' ? RUTA_INICIO : pathname}`;
    return NextResponse.redirect(url);
  }

  const cookie = req.cookies.get(COOKIE_SESION)?.value;
  const loginDelTenant = rutaLogin(tenant);
  const esLogin = pathname === loginDelTenant || pathname.startsWith(`${loginDelTenant}/`);

  if (!cookie && !esLogin) {
    const url = req.nextUrl.clone();
    url.pathname = loginDelTenant;
    const destino = `${pathname}${req.nextUrl.search}`;
    url.search = `?volver=${encodeURIComponent(destino)}`;
    return NextResponse.redirect(url);
  }

  if (cookie) {
    const slug = slugDelToken(cookie);
    if (slug && slug !== tenant) {
      const url = req.nextUrl.clone();
      const resto = pathname.slice(`/${tenant}`.length);
      url.pathname = `/${slug}${resto || RUTA_INICIO}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Matcher MINIMO (el ejemplo de la doc de Next). Sin `.*\..*` ni grupos raros: el filtro fino de
  // archivos estaticos esta en el codigo, que se lee y se testea.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
