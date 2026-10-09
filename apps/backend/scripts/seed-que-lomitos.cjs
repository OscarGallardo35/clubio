/**
 * Seed del tenant DEMO `que-lomitos` (personalizacion de la tarjeta por theme JSON).
 *
 *   node scripts/seed-que-lomitos.cjs             # aplica (upsert idempotente)
 *   node scripts/seed-que-lomitos.cjs --dry-run   # muestra que haria, no escribe
 *
 * Lee el .env de la raiz (dotenv-lite, sin dependencias) si DATABASE_URL no esta
 * en el entorno. No necesita .env.secrets (no toca bcrypt ni firma nada).
 *
 * IDEMPOTENTE: todo va con upsert (o findFirst+update por clave natural), asi que
 * re-correrlo deja el mismo estado y no duplica ni negocio, ni sucursal, ni cliente,
 * ni items de carta.
 *
 * QUE CREA
 * - Negocio  slug `que-lomitos`, nombre `Que Lomitos`, colorPrimario #C8102E + `theme` JSON
 *   (el que habilita el diseno personalizado de la tarjeta; sin el, la tarjeta cae al
 *   diseno por defecto).
 * - ConfiguracionClub: SOLO_VISITAS, 8 sellos, premio 'Lomito gratis', mostrarResenaPostVisita.
 * - 1 sucursal principal (`centro`) y 5 items de carta.
 * - 1 cliente demo (GLOBAL: sellos en `Cliente.sellosActuales` + su TarjetaClienteSucursal
 *   en la sucursal principal) para poder ver su tarjeta. La cookie NO se firma aca:
 *   usar scripts/firmar-cookie-cliente.cjs.
 *
 * NO TOCA otros negocios: filtra TODO por el id/slug de que-lomitos.
 */
const { PrismaClient, Plan, ModoFidelizacion, ModoClientes } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

// dotenv-lite: el .env de la raiz, sin dependencias.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '..', '..', '.env')
  if (fs.existsSync(envPath)) {
    for (const linea of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const prisma = new PrismaClient()
const DRY = process.argv.includes('--dry-run')

const SLUG = 'que-lomitos'
const NOMBRE = 'Qué Lomitos'
const COLOR_PRIMARIO = '#C8102E'
const TELEFONO_DEMO = '+5491166600001'

/**
 * Theme de la tarjeta. Debe coincidir con `TenantTheme` de @repo/types:
 *   colores { bg, accent, brandDark, text, textMuted }
 *   sello   { rotacionBase, forma }
 *   imagenFondo (path publico de la PWA; si falta el archivo cae al color `bg`)
 *   mostrarPuntos (false oculta la 2da barra de puntos en modo HIBRIDO)
 */
const THEME = {
  colores: {
    bg: COLOR_PRIMARIO,
    accent: '#FFD166',
    brandDark: '#7A0A1C',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.45)',
  },
  sello: { rotacionBase: 0, forma: 'circulo' },
  imagenFondo: `/tenants/${SLUG}/bg.webp`,
  mostrarPuntos: false,
}

/** 5 items de carta: lo minimo para que la demo tenga un menu con onda. */
const ITEMS = [
  { categoria: 'Lomitos', nombre: 'Lomito completo', descripcion: 'Lomo, jamon, queso, huevo, lechuga y tomate', precio: 8900, etiquetas: [], orden: 1 },
  { categoria: 'Lomitos', nombre: 'Lomito de pollo', descripcion: 'Pollo grillado con mayonesa casera', precio: 7900, etiquetas: [], orden: 2 },
  { categoria: 'Acompanantes', nombre: 'Papas fritas', descripcion: 'Porcion grande, bien crocantes', precio: 3500, etiquetas: ['vegetariano'], orden: 1 },
  { categoria: 'Bebidas', nombre: 'Coca-Cola 500ml', descripcion: 'Bien fria', precio: 1800, etiquetas: [], orden: 1 },
  { categoria: 'Bebidas', nombre: 'Agua mineral 500ml', descripcion: 'Con o sin gas', precio: 1200, etiquetas: [], orden: 2 },
]

async function upsertNegocio() {
  const data = {
    nombre: NOMBRE,
    slug: SLUG,
    cuit: '30-71000000-1',
    telefono: '+5491166600000',
    direccion: 'Av. de los Lomitos 1234, CABA',
    email: 'hola@quelomitos.demo',
    colorPrimario: COLOR_PRIMARIO,
    colorSecundario: '#FFFFFF',
    plan: Plan.PRO,
    modoClientes: ModoClientes.GLOBAL,
    payPerUseActivo: false,
    activo: true,
    theme: THEME,
  }
  if (DRY) {
    const existente = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } })
    return { id: existente?.id ?? 'DRY', creado: !existente }
  }
  const existente = await prisma.negocio.findUnique({ where: { slug: SLUG }, select: { id: true } })
  const negocio = await prisma.negocio.upsert({
    where: { slug: SLUG },
    update: data,
    create: data,
    select: { id: true },
  })
  return { id: negocio.id, creado: !existente }
}

async function upsertConfig(negocioId) {
  const data = {
    negocioId,
    modoFidelizacion: ModoFidelizacion.SOLO_VISITAS,
    sellosParaPremio: 8,
    premioTexto: 'Lomito gratis',
    sellosBienvenida: 1,
    limiteVisitasPorDia: 1,
    horasMinimasEntreVisitas: 4,
    requiereValidacionEmpleado: true,
    permiteRegaloManual: true,
    mensajeBienvenida: 'Suma 8 sellos y te llevas un lomito gratis.',
    mostrarResenaPostVisita: true,
    menuActivo: true,
  }
  if (DRY) return data
  return prisma.configuracionClub.upsert({ where: { negocioId }, update: data, create: data })
}

async function upsertSucursal(negocioId) {
  const data = {
    negocioId,
    nombre: 'Centro',
    slug: 'centro',
    direccion: 'Av. de los Lomitos 1234, CABA',
    telefono: '+5491166600000',
    numeroAtendiente: '+5491166600000',
    esPrincipal: true,
    activa: true,
  }
  if (DRY) return { id: 'DRY', ...data }
  return prisma.sucursal.upsert({
    where: { negocioId_slug: { negocioId, slug: 'centro' } },
    update: data,
    create: data,
    select: { id: true },
  })
}

async function upsertItems(negocioId) {
  if (DRY) return ITEMS.length
  let n = 0
  for (const it of ITEMS) {
    const existente = await prisma.itemCarta.findFirst({
      where: { negocioId, nombre: it.nombre },
      select: { id: true },
    })
    const data = { negocioId, ...it, disponible: true }
    if (existente) {
      await prisma.itemCarta.update({ where: { id: existente.id }, data })
    } else {
      await prisma.itemCarta.create({ data })
    }
    n++
  }
  return n
}

async function upsertClienteDemo(negocioId, sucursalId) {
  const data = {
    negocioId,
    nombre: 'Cliente Demo',
    telefono: TELEFONO_DEMO,
    aceptaNotificaciones: false,
    tienePwaInstalada: false,
    sellosActuales: 3,
    puntosActuales: 0,
    totalVisitas: 3,
    premiosCanjeados: 0,
  }
  if (DRY) return { id: 'DRY', ...data }
  const cliente = await prisma.cliente.upsert({
    where: { negocioId_telefono: { negocioId, telefono: TELEFONO_DEMO } },
    update: data,
    create: data,
    select: { id: true },
  })
  await prisma.tarjetaClienteSucursal.upsert({
    where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId } },
    update: { sellosActuales: 3, totalVisitas: 3 },
    create: { clienteId: cliente.id, sucursalId, sellosActuales: 3, totalVisitas: 3 },
  })
  return { id: cliente.id }
}

async function main() {
  console.log('\n  Seed que-lomitos' + (DRY ? '  [DRY-RUN]' : '  [APLICANDO]'))
  const neg = await upsertNegocio()
  console.log(`   negocio: ${neg.creado ? 'CREADO' : 'actualizado'} (${SLUG})`)
  if (DRY) {
    await upsertConfig(neg.id)
    await upsertSucursal(neg.id)
    await upsertItems(neg.id)
    console.log('   [DRY-RUN] no se escribio nada. Correr sin --dry-run para aplicar.')
    return
  }
  await upsertConfig(neg.id)
  const suc = await upsertSucursal(neg.id)
  const items = await upsertItems(neg.id)
  const cli = await upsertClienteDemo(neg.id, suc.id)
  console.log(`   configuracionClub: OK (SOLO_VISITAS / 8 sellos / "Lomito gratis")`)
  console.log(`   sucursal: ${suc.id}`)
  console.log(`   items de carta: ${items}`)
  console.log(`   cliente demo: ${cli.id} (telefono ${TELEFONO_DEMO}, 3 sellos)`)
  console.log('\n  Listo. Para la cookie del cliente demo:')
  console.log('   node scripts/firmar-cookie-cliente.cjs que-lomitos ' + TELEFONO_DEMO)
  console.log('')
}

main()
  .catch((e) => { console.error('  ERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
