const { execSync } = require('child_process');

/** Commit actual, para que la pantalla de dev muestre que version se mira al iterar. */
function commitActual() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

/**
 * `output: 'standalone'` arma .next/standalone copiando node_modules con SYMLINKS.
 * En Windows eso falla con EPERM sin Modo Desarrollador, asi que ahi se compila
 * normal; en Linux (Docker/CI) se activa solo. Se puede forzar con NEXT_OUTPUT.
 */
function salidaStandalone() {
  if (process.env.NEXT_OUTPUT === 'standalone') return 'standalone';
  if (process.env.NEXT_OUTPUT === 'default') return undefined;
  return process.platform === 'win32' ? undefined : 'standalone';
}

/**
 * `NEXT_DIST_DIR` permite compilar sin pisar el `.next` que esta sirviendo el dev
 * server (mismo mecanismo que la PWA Cliente).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: salidaStandalone(),
  env: { NEXT_PUBLIC_COMMIT: commitActual() },

  /**
   * Compatibilidad con el formato VIEJO del link del mensaje al local
   * (`/pedido/<linkToken>` -> `/validar-pedido?ref=<linkToken>`), con un 308 real.
   *
   * Va aca y NO en una pagina con `permanentRedirect()`: el layout de `(staff)` hace streaming,
   * asi que la respuesta ya salio con 200 y Next degrada el redirect a client-side (deja
   * `NEXT_REDIRECT` en el payload: funciona en el browser, pero el status sigue siendo 200 y un
   * `curl -I` no ve ningun 308). Los `redirects` del config corren ANTES del middleware y del
   * render, asi que el 308 viaja como header, tambien para un HEAD.
   *
   * 308 (permanente) porque el cambio de formato es definitivo: los mensajes ya enviados viven
   * en el WhatsApp del cliente para siempre, y el browser cachea el redirect.
   */
  async redirects() {
    /**
     * Compatibilidad de las URLs SIN tenant. La Staff es multi-tenant: cada pantalla vive en
     * `/<tenant>/...`, asi que los bookmarks y los links ya compartidos (WhatsApp, QR impreso) siguen
     * entrando por el path viejo y aterrizan en el tenant por defecto. Los `redirects` del config
     * corren ANTES del middleware y del render, asi que el 308 viaja como header (tambien en un HEAD);
     * el middleware queda como red de seguridad para cualquier ruta no listada.
     *
     * El default sale de `NEXT_PUBLIC_DEFAULT_TENANT`: el dia que haya 2+ locales activos, estas
     * entradas se pueden borrar (nadie deberia estar entrando sin slug).
     */
    const D = process.env.NEXT_PUBLIC_DEFAULT_TENANT || 'bar-la-esquina';
    // OJO: `/login` NO esta en la lista a proposito. El healthcheck de Railway pega ahi y rechaza un
    // 3xx (deploy en FAILED): esa ruta la sirve una pagina que responde 200 y reenvia desde el
    // cliente (ver `app/login/page.tsx` y el middleware).
    const SIN_TENANT = ['turnos', 'visitas', 'pedidos', 'perfil', 'carta', 'validar', 'validar-pedido'];
    return [
      { source: '/pedido/:token', destination: `/${D}/validar-pedido?ref=:token`, permanent: true },
      { source: '/', destination: `/${D}/turnos`, permanent: false },
      ...SIN_TENANT.map((r) => ({ source: `/${r}`, destination: `/${D}/${r}`, permanent: true })),
      { source: '/pedidos/:id', destination: `/${D}/pedidos/:id`, permanent: true },
    ];
  },
};

module.exports = nextConfig;
