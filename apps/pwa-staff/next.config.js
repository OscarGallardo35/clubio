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
    return [
      { source: '/pedido/:token', destination: '/validar-pedido?ref=:token', permanent: true },
    ];
  },
};

module.exports = nextConfig;
