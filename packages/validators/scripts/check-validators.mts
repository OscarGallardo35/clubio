/**
 * Cruza los enums de @repo/validators contra apps/backend/prisma/schema.prisma.
 *
 *   pnpm --filter @repo/validators check:validators
 *
 * Por que existe: este package nacio roto (nadie lo importaba, asi que el build no
 * lo validaba) y tenia 6 listas de enums escritas a mano que no coincidian con el
 * schema: RECURRENTE en vez de REGULAR, EMAIL/IN_APP en vez de AMBOS, y un
 * EstadoPedido sin ENVIADO ni RECHAZADO. El schema es la fuente de verdad; este
 * check la hace ejecutable.
 *
 * Sin dependencias a proposito (fs + regex): node corre .mts borrando tipos y no
 * puede importar packages que usen parameter properties.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(aqui, '..', 'src')
const SCHEMA = join(aqui, '..', '..', '..', 'apps', 'backend', 'prisma', 'schema.prisma')

/** Listas que NO son columnas del schema (opciones de entrada de la app). */
const PERMITIDAS: Record<string, string> = {
  DESTINATARIOS_CAMPANA: 'opcion de entrada de la campana (TODOS/ETIQUETA/INDIVIDUAL), no es una columna',
}

let ok = 0
const fallas: string[] = []
const chk = (nombre: string, cond: boolean, detalle = '') => {
  if (cond) { ok++; console.log(`  OK    ${nombre}`) }
  else { fallas.push(nombre); console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`) }
}

// --- 1. enums del schema (fuente de verdad) ---
const schemaTxt = readFileSync(SCHEMA, 'utf8')
const enumsSchema: Record<string, string[]> = {}
for (const m of schemaTxt.matchAll(/enum\s+(\w+)\s*\{([\s\S]*?)\}/g)) {
  enumsSchema[m[1]] = m[2].split(/\s+/).map((v) => v.trim()).filter((v) => v && !v.startsWith('//') && !v.startsWith('@'))
}
console.log(`=== schema.prisma: ${Object.keys(enumsSchema).length} enums ===`)

// --- 2. archivos del package ---
const archivos: string[] = []
const recorrer = (dir: string) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) recorrer(p)
    else if (p.endsWith('.ts')) archivos.push(p)
  }
}
recorrer(SRC)
/**
 * Sin comentarios: las reglas miran codigo. El comentario de lib/cuid.ts explica
 * justamente por que NO hay que usar .uuid(), y contaba como si lo usara.
 */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const fuentes = archivos.map((f) => ({
  ruta: f.replace(SRC, 'src').replace(/\\/g, '/'),
  texto: readFileSync(f, 'utf8'),
  codigo: sinComentarios(readFileSync(f, 'utf8')),
}))
console.log(`=== @repo/validators: ${fuentes.length} archivos ===\n`)

// --- 3. listas declaradas (const X = [...] as const) ---
const listas: Record<string, { valores: string[]; linea: number }> = {}
for (const f of fuentes) {
  for (const m of f.texto.matchAll(/export const ([A-Z_]+)\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
    listas[m[1]] = {
      valores: [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]),
      linea: f.texto.slice(0, m.index).split('\n').length,
    }
  }
}

// --- 4. cada z.enum() tiene que coincidir EXACTO con un enum del schema ---
console.log('=== z.enum() contra el schema ===')
let usos = 0
for (const f of fuentes) {
  for (const m of f.texto.matchAll(/z\.enum\(([^)]*)\)/g)) {
    usos++
    const linea = f.texto.slice(0, m.index).split('\n').length
    const arg = m[1].trim()
    const inline = [...arg.matchAll(/'([^']+)'/g)].map((v) => v[1])
    const nombreConst = inline.length ? null : arg
    const valores = inline.length ? inline : (listas[arg]?.valores ?? [])
    const etiqueta = `${f.ruta}:${linea} (${arg})`

    if (!valores.length) { chk(etiqueta, false, 'no se pudo resolver la lista'); continue }

    const coincide = Object.entries(enumsSchema).find(
      ([, vals]) => vals.length === valores.length && vals.every((v) => valores.includes(v)),
    )
    if (coincide) { chk(`${etiqueta} == enum ${coincide[0]}`, true); continue }

    if (nombreConst && PERMITIDAS[nombreConst]) { chk(`${etiqueta} permitida (${PERMITIDAS[nombreConst]})`, true); continue }

    // reportar el enum del schema mas parecido
    const candidato = Object.entries(enumsSchema)
      .map(([n, vals]) => ({ n, vals, comunes: vals.filter((v) => valores.includes(v)).length }))
      .sort((a, b) => b.comunes - a.comunes)[0]
    const faltan = candidato ? valores.filter((v) => !candidato.vals.includes(v)) : []
    const sobran = candidato ? candidato.vals.filter((v) => !valores.includes(v)) : []
    chk(etiqueta, false,
      `no coincide con ningun enum` +
      (candidato ? ` | vs ${candidato.n}: no existen en el schema ${JSON.stringify(faltan)}, no valida ${JSON.stringify(sobran)}` : ''))
  }
}
chk(`se revisaron los ${usos} z.enum() del package`, usos > 0)

// --- 5. los IDs son cuid: no se acepta .uuid() ---
console.log('\n=== IDs (el schema usa @default(cuid())) ===')
const conUuid = fuentes.filter((f) => f.codigo.includes('.uuid('))
chk('ningun .uuid() en el package', conUuid.length === 0, conUuid.map((f) => f.ruta).join(', '))
const usosCuid = fuentes.reduce((n, f) => n + (f.texto.match(/cuidSchema/g) ?? []).length, 0)
chk(`los campos de ID usan cuidSchema (${usosCuid} referencias)`, usosCuid >= 9)

// --- 6. toda lista declarada se usa, y toda lista usada esta declarada ---
console.log('\n=== listas declaradas vs usadas ===')
const usadas = new Set([...fuentes.flatMap((f) => [...f.codigo.matchAll(/z\.enum\(([A-Z_]+)\)/g)].map((m) => m[1]))])
for (const nombre of Object.keys(listas)) {
  const usada = usadas.has(nombre)
  const permitida = Boolean(PERMITIDAS[nombre])
  chk(`lista ${nombre} (linea ${listas[nombre].linea}) usada o justificada`, usada || permitida, usada ? '' : 'declarada y nunca usada')
}

console.log(`\n  TOTAL: ${ok} OK, ${fallas.length} FALLA`)
if (fallas.length) {
  console.log('  FALLARON: ' + fallas.join(' | '))
  process.exit(1)
}
