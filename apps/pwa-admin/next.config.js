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
   * Las PWAs consumen `@repo/ui` desde el SOURCE (`main: src/index.ts`), no desde un `dist`:
   * Next tiene que transpilar esos paquetes del workspace, no solo resolver el symlink de pnpm.
   */
  transpilePackages: ['@repo/ui', '@repo/types', '@repo/validators', '@repo/utils', '@repo/api-client'],

  /**
   * Compatibilidad de las URLs SIN tenant. El Admin es multi-tenant: cada pantalla vive en
   * `/<tenant>/...`, asi que los bookmarks y los links ya compartidos siguen entrando por el path
   * viejo y aterrizan en el tenant por defecto. Los `redirects` del config corren ANTES del
   * middleware y del render, asi que el 308 viaja como header (tambien en un HEAD); el middleware
   * queda como red de seguridad para cualquier ruta no listada.
   *
   * El default sale de `NEXT_PUBLIC_DEFAULT_TENANT`: el dia que haya 2+ locales activos, estas
   * entradas se pueden borrar (nadie deberia estar entrando sin slug).
   */
  async redirects() {
    const D = process.env.NEXT_PUBLIC_DEFAULT_TENANT || 'bar-la-esquina';
    // OJO: `/login` NO esta en la lista a proposito. El healthcheck de Railway pega ahi y rechaza un
    // 3xx; por eso `/login` sirve una pagina propia que devuelve 200 y reenvia desde el cliente (ver
    // `app/login/page.tsx` y el middleware).
    const SIN_TENANT = ['dashboard', 'carta', 'personal', 'sucursales', 'configuracion', 'qr'];
    return [
      // La raiz va al dashboard del default (307: es un default que puede cambiar).
      { source: '/', destination: `/${D}/dashboard`, permanent: false },
      ...SIN_TENANT.map((r) => ({ source: `/${r}`, destination: `/${D}/${r}`, permanent: true })),
      // Subruta de Google: mas especifica que '/configuracion' (que ya esta arriba).
      { source: '/configuracion/google', destination: `/${D}/configuracion/google`, permanent: true },
    ];
  },
};

module.exports = nextConfig;
