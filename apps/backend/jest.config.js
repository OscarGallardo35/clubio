/**
 * Jest para los UNIT TESTS del backend (los *_*.spec.ts de `src/`).
 *
 * El repo no tenia config de jest (solo la dependencia): `pnpm --filter backend test` no corria
 * nada. Esta config levanta los specs de `src/**` con ts-jest y mapea los alias `@repo/*` a los
 * paquetes del monorepo (mismo destino que `tsconfig.json`), asi un spec puede importar un
 * servicio real sin romper por un import transitivo a un paquete del workspace.
 */
const path = require('path');

module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@repo/types$': path.join(__dirname, '../../packages/types/dist'),
    '^@repo/types/(.*)$': path.join(__dirname, '../../packages/types/dist/$1'),
    '^@repo/utils$': path.join(__dirname, '../../packages/utils/src'),
    '^@repo/utils/(.*)$': path.join(__dirname, '../../packages/utils/src/$1'),
    '^@repo/validators$': path.join(__dirname, '../../packages/validators/src'),
    '^@repo/validators/(.*)$': path.join(__dirname, '../../packages/validators/src/$1'),
  },
  // Sin cobertura: `test:cov` la pide aparte.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
};
