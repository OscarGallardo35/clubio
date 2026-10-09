import { NextResponse, type NextRequest } from 'next/server'
import { tenantDelSubdominio } from '@/lib/tenant'

/**
 * Soporte DUAL de tenants: la URL del cliente puede venir como **subdominio**
 * (`bar-la-esquina.app.clubio.lat/menu`) o como **path** (`app.clubio.lat/bar-la-esquina/menu`).
 *
 * Aca se REESCRIBE el subdominio a la ruta interna (`/[tenant]/menu`): el navegador sigue mostrando
 * `bar-la-esquina.app.clubio.lat/menu` y la app renderiza el mismo componente que en el path. Los
 * dos formatos conviven, asi que ningun link ya compartido (WhatsApp, QR impreso, favoritos) se
 * rompe.
 *
 * Tres detalles que importan:
 *
 * 1. `tenantDelSubdominio` es el MISMO helper que usa la app para resolver el tenant, con la misma
 *    lista de reservados (`www`, `app`, `api`, `staff`, `admin`, `localhost`): una sola verdad. Si
 *    el host no es un subdominio de tenant (el dominio pelado, un preview de Railway), no se toca
 *    nada.
 * 2. Los links INTERNOS de la app ya llevan el slug (`/bar-la-esquina/tarjeta` sale de las RUTAS),
 *    asi que en el subdominio llegan como `/bar-la-esquina/tarjeta`: prefijarlos otra vez daria
 *    `/bar-la-esquina/bar-la-esquina/tarjeta` y un 404. De eso se encarga el chequeo de `primero`.
 * 3. Las rutas de sesion (`/historial`, `/seleccionar-sucursal`, ...) viven en la RAIZ del app, no
 *    dentro de `[tenant]`: tampoco se reescriben.
 *
 * El filtro fino de assets va en el CODIGO y no en el `matcher`: una regex con `\\.` dentro del
 * matcher hace que Next descarte el middleware entero sin avisar (ver TROUBLESHOOTING, regla del
 * middleware de la PWA Staff).
 */
const RUTAS_RAIZ = new Set(['historial', 'seleccionar-sucursal', 'offline', 'dev'])

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const slug = tenantDelSubdominio(req.headers.get('host'))
  if (!slug) return NextResponse.next()

  // Assets, API e internos de Next: nunca se tocan.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    /\.[a-z0-9]+$/i.test(pathname)
  ) {
    return NextResponse.next()
  }

  // La raiz del subdominio no tiene pagina propia (`[tenant]` no tiene `page.tsx`): se manda al
  // menu, que es a donde apunta el QR. Redirect y no rewrite para que la URL quede clara.
  if (pathname === '/') {
    const url = req.nextUrl.clone()
    url.pathname = `/${slug}/menu`
    return NextResponse.redirect(url)
  }

  const primero = (pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase()
  // Ya viene con el tenant (link interno) o es una ruta de sesion: se deja como esta.
  if (primero === slug.toLowerCase() || RUTAS_RAIZ.has(primero)) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = `/${slug}${pathname}`
  return NextResponse.rewrite(url)
}

export const config = {
  // Matcher MINIMO a proposito (ver el docblock): el resto se filtra en el codigo.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
