const { execSync } = require('child_process');

/**
 * Commit actual, para que /dev/ui muestre que version se esta mirando al iterar.
 * Si no hay git (imagen de Docker sin .git) queda "dev" en vez de romper.
 */
function commitActual() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/**
 * `output: 'standalone'` arma .next/standalone copiando node_modules con
 * SYMLINKS. En Windows eso falla con EPERM si no esta activado el Modo
 * Desarrollador, asi que ahi se compila normal. En Linux (Docker/CI, que es
 * donde corre el Dockerfile) se activa solo. Se puede forzar con NEXT_OUTPUT.
 */
function salidaStandalone() {
  if (process.env.NEXT_OUTPUT === 'standalone') return 'standalone';
  if (process.env.NEXT_OUTPUT === 'default') return undefined;
  return process.platform === 'win32' ? undefined : 'standalone';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lo usa el Dockerfile: node apps/pwa-cliente/server.js
  output: salidaStandalone(),
  // Los packages internos se publican como TS fuente (main: src/index.ts):
  // Next tiene que compilarlos.
  transpilePackages: ['@repo/ui', '@repo/types', '@repo/validators', '@repo/utils', '@repo/api-client'],
  env: {
    NEXT_PUBLIC_COMMIT: commitActual(),
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.railway.app' },
      { protocol: 'https', hostname: '*.clubio.lat' },
    ],
  },
};

module.exports = nextConfig;
