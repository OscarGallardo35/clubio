/**
 * Firma una cookie de sesion de CLIENTE para un negocio/telefono del seed.
 *
 *   node scripts/firmar-cookie-cliente.cjs <negocioSlug> <telefono>
 *
 * Lee .env y .env.secrets de la raiz (dotenv-lite). El TOKEN NUNCA se imprime:
 * se escribe en un archivo fuera del repo (en TMPDIR) y solo se reporta el path,
 * el largo y los claims (sin firma). Pensado para verificar la tarjeta en el
 * navegador o con curl.
 *
 * Claims = los que emite auth.service.ts -> firmar(payload,'cliente'):
 *   { sub, negocioId, negocioSlug, tipo: 'cliente', jti, iat, exp }
 * El nombre de la cookie es `cliente_token` (ver common/utils/cookie.util.ts).
 */
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')

/** JWT HS256 sin dependencias: el formato lo impone passport-jwt, no una lib. */
function firmarHS256(payload, secret, expSegundos) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const ahora = Math.floor(Date.now() / 1000)
  const body = { ...payload, jti: crypto.randomUUID(), iat: ahora, exp: ahora + expSegundos }
  const dato = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`
  const firma = crypto.createHmac('sha256', secret).update(dato).digest('base64url')
  return `${dato}.${firma}`
}

/** "30d" / "12h" / "45m" -> segundos. */
function duracionSegundos(exp) {
  const m = /^(\d+)([smhd])$/.exec(String(exp || '30d').trim())
  if (!m) return 30 * 24 * 3600
  const n = Number(m[1])
  return { s: n, m: n * 60, h: n * 3600, d: n * 86400 }[m[2]]
}

const RAIZ = path.join(__dirname, '..', '..', '..')

function cargarEnv(archivo, soloSiFalta) {
  const p = path.join(RAIZ, archivo)
  if (!fs.existsSync(p)) return
  for (const linea of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    if (soloSiFalta && process.env[m[1]]) continue
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
cargarEnv('.env', true)
cargarEnv('.env.secrets', false) // completar/override de secretos

const [negocioSlug, telefono] = process.argv.slice(2)
if (!negocioSlug || !telefono) {
  console.error('Uso: node scripts/firmar-cookie-cliente.cjs <negocioSlug> <telefono>')
  process.exit(1)
}
if (!process.env.JWT_CLIENTE_SECRET) {
  console.error('Falta JWT_CLIENTE_SECRET (revisar .env / .env.secrets)')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const negocio = await prisma.negocio.findUnique({ where: { slug: negocioSlug }, select: { id: true, slug: true } })
  if (!negocio) throw new Error(`No existe el negocio ${negocioSlug}`)
  const cliente = telefono === 'auto'
    ? await prisma.cliente.findFirst({
        where: { negocioId: negocio.id, eliminadoEn: null },
        orderBy: [{ totalVisitas: 'desc' }],
        select: { id: true, nombre: true, telefono: true },
      })
    : await prisma.cliente.findFirst({
        where: { negocioId: negocio.id, telefono },
        select: { id: true, nombre: true, telefono: true },
      })
  if (!cliente) throw new Error(`No hay cliente ${telefono} en ${negocioSlug}`)

  const token = firmarHS256(
    { sub: cliente.id, negocioId: negocio.id, negocioSlug: negocio.slug, tipo: 'cliente' },
    process.env.JWT_CLIENTE_SECRET,
    duracionSegundos(process.env.JWT_CLIENTE_EXPIRES_IN),
  )
  const cookie = `cliente_token=${token}`

  const salida = path.join(os.tmpdir(), `cookie-${negocioSlug}.txt`)
  fs.writeFileSync(salida, cookie, 'utf8')

  console.log(`  negocio: ${negocio.slug} (${negocio.id})`)
  console.log(`  cliente: ${cliente.nombre} ${cliente.telefono}`)
  console.log(`  cookie 'cliente_token' -> ${salida}`)
  console.log(`  largo del JWT: ${token.length} (no se imprime el valor)`)
}

main()
  .catch((e) => { console.error('  ERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
