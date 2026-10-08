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
};

module.exports = nextConfig;
