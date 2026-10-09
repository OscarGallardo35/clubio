import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_TENANT, RUTA_INICIO } from '@/lib/constants';
import { rutaLogin, slugDelToken, tenantDePath } from '@/lib/tenant';

/**
 * Guard de rutas Y de tenant de la PWA Admin.
 *
 * Cada pantalla vive bajo `/<tenant>/...`. El middleware hace tres cosas, en este orden:
 *
 * 1. **Sin tenant en la URL** (raiz o links viejos): manda al tenant por defecto. Los casos
 *    conocidos los cubren los `redirects` de `next.config.js`, que corren ANTES que esto; aca queda
 *    la red de seguridad para cualquier ruta no listada.
 * 2. **Sin cookie de sesion**: a `/<tenant>/login?volver=<destino>`. El `volver` conserva la query
 *    para no perder el destino exacto (con parametros) al pasar por el login.
 * 3. **Sesion de OTRO negocio**: si el token viene con un `negocioSlug` distinto al de la URL, se
 *    manda al slug del token. La cookie es HttpOnly y aca NO se verifica la firma (no hay secret en
 *    el edge, ni hace falta): se decodifica el payload y se compara. La barrera real es el backend,
 *    que resuelve el negocio del token en cada request; esto es UX, para no dejar a nadie parado en
 *    la UI de otro local.
 *
 * El filtro de archivos estaticos va ACA y no en `matcher`: un `.*\..*` dentro del matcher hace que
 * Next descarte el middleware ENTERO sin avisar (ver TROUBLESHOOTING).
 */
const COOKIE_SESION = 'dueno_token';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Assets con extension (.png, .json, .ico, ...) y las rutas internas de Next no pasan por el guard.
  if (pathname.startsWith('/_next') || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next();
  }

  const tenant = tenantDePath(pathname);

  // `/login` (la URL vieja, sin slug) NO se redirige a un local por defecto. Antes, la pagina
  // reenviaba a `DEFAULT_TENANT` (el slug del seed: `bar-la-esquina`), asi que el dueno de OTRO
  // local que entraba por un bookmark/link sin slug terminaba en el login del seed y sus
  // credenciales daban 401 (bug reportado con `que-lomitos`).
  //
  // Ahora: si YA hay sesion, se sigue al negocio DEL TOKEN (`slugDelToken`); si no, la pagina
  // muestra un selector de local (devuelve 200). El healthcheck de Railway NO manda cookie, asi
  // que nunca cae en el redirect y sigue viendo 200 (un 3xx lo dejaria en FAILED).
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    const cookieLogin = req.cookies.get(COOKIE_SESION)?.value;
    const slugSesion = slugDelToken(cookieLogin);
    if (slugSesion) {
      const url = req.nextUrl.clone();
      url.pathname = `/${slugSesion}${RUTA_INICIO}`;
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

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

  // Sesion de OTRO negocio -> al slug del token, PERO NUNCA en una ruta de login: el login es
  // justamente donde se cambia de cuenta. Si no se excluye, alguien con una sesion vieja de otro
  // local queda rebotado de `/<tenantB>/login` a `/<tenantA>/login` y no puede entrar nunca
  // (bug real: dueno de que-lomitos con cookie de bar-la-esquina -> 307 a bar-la-esquina).
  if (cookie && !esLogin) {
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
