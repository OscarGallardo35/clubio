/**
 * Semilla / utilidades del SUPER-ADMIN de la plataforma.
 *
 * Este es el usuario del panel del operador (app `apps/pwa-superadmin`): NO es el dueno
 * de un local, no tiene negocio ni sucursal, y su sesion vive en la cookie
 * `superadmin_token` (host-only) firmada con `JWT_SUPER_ADMIN_SECRET`.
 *
 * Uso (desde `apps/backend`):
 *   node scripts/seed-superadmin.cjs              # crea si NO existe; si ya existe, solo reporta
 *   node scripts/seed-superadmin.cjs --reset      # reescribe la password y APAGA el 2FA (para poder entrar)
 *   node scripts/seed-superadmin.cjs --2fa on     # habilita el 2FA con el secreto de .env.secrets
 *   node scripts/seed-superadmin.cjs --2fa off    # deshabilita el 2FA
 *   node scripts/seed-superadmin.cjs --dry-run    # muestra que haria, no escribe
 *
 * ---------------------------------------------------------------------------
 * CREDENCIALES (se leen de aca, nunca del chat)
 * ---------------------------------------------------------------------------
 * email:    `SUPER_ADMIN_EMAIL` de `.env.secrets`  (default de demo: admin@fideliza.app)
 * password: `SUPER_ADMIN_PASSWORD` de `.env.secrets`
 *           Si esa variable NO esta definida, se usa la contrasena de DEMO de abajo:
 *               SuperAdmin2026!
 * 2FA:      `SUPER_ADMIN_2FA_SECRET` de `.env.secrets` (base32, compatible con
 *           Google Authenticator). Sin esa variable no se puede habilitar 2FA.
 *
 * OJO: en este repo `.env.secrets` YA trae las tres variables, asi que la password
 * efectiva es la de ese archivo (`SUPER_ADMIN_PASSWORD`) y NO la de demo. El script
 * nunca imprime secretos: solo dice que variables uso y si estan definidas.
 *
 * Idempotente: sin flags no toca una fila existente (no rota credenciales por accidente).
 */
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

// dotenv-lite (sin dependencias): .env y .env.secrets de la raiz del monorepo.
// OJO con el `\r`: .env.secrets tiene finales de linea CRLF; con `(.*)$` el `$` no
// matchea antes del `\r` y las variables se leen vacias (bug real de este script).
const raiz = path.join(__dirname, '..', '..', '..')
for (const nombre of ['.env', '.env.secrets']) {
  const p = path.join(raiz, nombre)
  if (!fs.existsSync(p)) continue
  for (const linea of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const prisma = new PrismaClient()

const DRY = process.argv.includes('--dry-run')
const RESET = process.argv.includes('--reset')
const idx2fa = process.argv.indexOf('--2fa')
const MODO_2FA = idx2fa >= 0 ? (process.argv[idx2fa + 1] || '').toLowerCase() : null

// Contrasena de DEMO (solo se usa si SUPER_ADMIN_PASSWORD no esta en el entorno).
const PASSWORD_DEMO = 'SuperAdmin2026!'

const EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'admin@fideliza.app').toLowerCase().trim()
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD || PASSWORD_DEMO
const SECRETO_2FA = process.env.SUPER_ADMIN_2FA_SECRET || null
const NOMBRE = 'Super Admin'

// bcryptjs (JS puro) y no el `bcrypt` nativo: el nativo no carga en este entorno y el
// formato del hash es el mismo, asi que el backend lo compara igual (misma decision
// que `seed-que-lomitos.cjs`).
const bcrypt = (() => {
  try { return require('bcryptjs') } catch { return require('bcrypt') }
})()

async function main() {
  console.log('Super-admin (panel de plataforma)')
  console.log('  email:', EMAIL)
  console.log('  origen de la password:', process.env.SUPER_ADMIN_PASSWORD ? '.env.secrets (SUPER_ADMIN_PASSWORD)' : 'DEMO hardcodeada en este script')
  console.log('  SUPER_ADMIN_2FA_SECRET definido:', !!SECRETO_2FA)
  console.log('  modo:', [DRY ? 'dry-run' : 'aplica', RESET ? 'reset' : '', MODO_2FA ? `2fa=${MODO_2FA}` : ''].filter(Boolean).join(' '))

  const existente = await prisma.superAdmin.findUnique({ where: { email: EMAIL } })

  // ---- 2FA on/off (independiente de la password) ----
  if (MODO_2FA) {
    if (!existente) {
      console.error('No existe la fila: primero creala (sin flags o con --reset).')
      process.exitCode = 1
      return
    }
    if (MODO_2FA === 'on' && !SECRETO_2FA && !existente.twoFactorSecret) {
      console.error('Para habilitar 2FA hace falta SUPER_ADMIN_2FA_SECRET en .env.secrets (no hay secreto previo en la DB).')
      process.exitCode = 1
      return
    }
    const habilitar = MODO_2FA === 'on'
    if (DRY) {
      console.log(`[dry-run] twoFactorEnabled = ${habilitar}`)
      return
    }
    await prisma.superAdmin.update({
      where: { id: existente.id },
      data: {
        twoFactorEnabled: habilitar,
        // Reusa el secreto existente; si no hay, el de .env.secrets.
        ...(habilitar && !existente.twoFactorSecret && SECRETO_2FA ? { twoFactorSecret: SECRETO_2FA } : {}),
      },
    })
    console.log(`OK: twoFactorEnabled = ${habilitar}`)
    return
  }

  // ---- Reset de credenciales (necesario para ENTRAR cuando la password se perdio) ----
  if (RESET) {
    if (!existente) {
      console.error('No existe la fila: correlo sin flags para crearla.')
      process.exitCode = 1
      return
    }
    if (DRY) {
      console.log('[dry-run] reescribiria passwordHash y pondria twoFactorEnabled = false')
      return
    }
    await prisma.superAdmin.update({
      where: { id: existente.id },
      data: {
        passwordHash: bcrypt.hashSync(PASSWORD, 10),
        // false: el panel tiene que poder entrar YA. El 2FA se activa despues con
        // `--2fa on` (reusa el secreto de .env.secrets / el que ya tiene la fila).
        twoFactorEnabled: false,
        activo: true,
        ...(SECRETO_2FA ? { twoFactorSecret: SECRETO_2FA } : {}),
      },
    })
    console.log('OK: password reescrita y 2FA APAGADO (activo=true). Cambiala despues de entrar.')
    return
  }

  // ---- Semilla normal: crea solo si falta ----
  if (existente) {
    console.log(`La fila ya existe (id ${existente.id}, activo=${existente.activo}, twoFactorEnabled=${existente.twoFactorEnabled}). No se toco nada.`)
    console.log('  Para poder entrar con la password de .env.secrets: --reset (y despues --2fa off)')
    return
  }

  if (DRY) {
    console.log('[dry-run] crearia el SuperAdmin con twoFactorEnabled=false')
    return
  }
  const creado = await prisma.superAdmin.create({
    data: {
      email: EMAIL,
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      nombre: NOMBRE,
      twoFactorSecret: SECRETO_2FA,
      // false para poder entrar (el panel pide 2FA recien cuando el operador lo activa).
      twoFactorEnabled: false,
      activo: true,
    },
  })
  console.log(`OK: SuperAdmin creado (id ${creado.id}).`)
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
