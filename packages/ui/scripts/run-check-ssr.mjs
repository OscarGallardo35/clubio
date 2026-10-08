/**
 * Corre las aserciones SSR del package.
 *
 * El `tsconfig.check.json` compila `src/` + `scripts/check-ssr.tsx` a CommonJS en
 * `.check-dist/`. Hace falta CommonJS y no el ESM de `dist/`: `tsc` NO le agrega la
 * extension `.js` a los imports relativos, asi que un ESM emitido no lo carga Node
 * (`ERR_MODULE_NOT_FOUND`: las PWAs consumen el SOURCE vía `transpilePackages`, por eso
 * nunca salto). En CJS, `require('./components/button')` resuelve sin extension.
 *
 * El shim `{"type":"commonjs"}` es para que Node no trate esos `.js` como ESM: el package
 * declara `"type": "module"`.
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

writeFileSync(new URL('../.check-dist/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }), 'utf8')

const require = createRequire(import.meta.url)
require('../.check-dist/scripts/check-ssr.js')
