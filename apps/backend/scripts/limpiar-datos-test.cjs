/**
 * Limpia los datos de prueba que dejan los harness de integracion y las corridas manuales.
 *
 *   node scripts/limpiar-datos-test.cjs            # DRY-RUN: muestra que borraria, no toca nada
 *   node scripts/limpiar-datos-test.cjs --apply    # ejecuta de verdad
 *
 * Lee el .env de la raiz solo (si DATABASE_URL no esta en el entorno), asi que corre con:
 *   pnpm --filter backend exec dotenv -e ../../.env -- node scripts/limpiar-datos-test.cjs
 * o directo:  node scripts/limpiar-datos-test.cjs
 *
 * QUE BORRA (siempre dentro del negocio de bar-la-esquina)
 * - Clientes de prueba por NOMBRE: 'E2E %', 'Prueba %' y 'Oscar Gabriel' (los crea el harness).
 * - Clientes por TELEFONO en los rangos de los harness: +5491112349000..9999,
 *   +5493585... y +5493587...  (verificado: NINGUN telefono del seed cae en esos rangos).
 * - En cascada: Visita, TokenValidacion, Pedido, TarjetaClienteSucursal, DispositivoCliente
 *   y NotificacionPush de esos clientes.
 * - Items de carta cuyo nombre empiece con 'Prueba' (tambien los crea el harness).
 *
 * QUE NO TOCA NUNCA
 * - El negocio bar-la-esquina, sus sucursales ni ConfiguracionClub.
 * - Empleados ni items de la carta del seed.
 * - EventoAuditoria: queda como historial (su clienteId es nullable).
 *
 * Idempotente: correrlo dos veces no cambia nada la segunda vez.
 */
const { PrismaClient } = require('@prisma/client')
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
const APLICAR = process.argv.includes('--apply')
const SLUG = 'bar-la-esquina'

const PREFIJOS_TEL = ['+5491112349', '+5493585', '+5493587']
const NOMBRES_EXACTOS = ['Oscar Gabriel']

/** Mismo criterio que enmascararTelefono del backend, para no escupir telefonos enteros. */
const enmascarar = (tel) => {
  const d = String(tel || '').replace(/\D/g, '')
  if (d.length <= 6) return '*'.repeat(d.length || 1)
  return `+${d.slice(0, 3)}****${d.slice(-4)}`
}

async function main() {
  const neg = await prisma.negocio.findFirst({ where: { slug: SLUG }, select: { id: true, nombre: true } })
  if (!neg) throw new Error(`No existe el negocio ${SLUG}: abortado (no hay nada seguro que limpiar)`)

  const dondeCliente = {
    negocioId: neg.id,
    OR: [
      { nombre: { startsWith: 'E2E ' } },
      { nombre: { startsWith: 'Prueba ' } },
      ...NOMBRES_EXACTOS.map((n) => ({ nombre: n })),
      ...PREFIJOS_TEL.map((p) => ({ telefono: { startsWith: p } })),
    ],
  }

  const clientes = await prisma.cliente.findMany({
    where: dondeCliente,
    select: {
      id: true, nombre: true, telefono: true, creadoEn: true,
      _count: { select: { visitas: true, pedidos: true, tokensValidacion: true, tarjetas: true, dispositivos: true, notificaciones: true } },
    },
    orderBy: { creadoEn: 'asc' },
  })
  const ids = clientes.map((c) => c.id)

  // Los pedidos de los harness son de INVITADO (clienteId null): el filtro por cliente no los
  // agarra, asi que se buscan por sus propias marcas (nombreCliente / telefono del pedido).
  const pedidosSueltos = await prisma.pedido.findMany({
    where: {
      negocioId: neg.id,
      clienteId: null,
      OR: [
        { nombreCliente: { startsWith: 'E2E ' } },
        { nombreCliente: { startsWith: 'Prueba ' } },
        ...PREFIJOS_TEL.map((p) => ({ telefono: { startsWith: p } })),
      ],
    },
    select: { id: true, nombreCliente: true, telefono: true, tipo: true, estado: true, total: true, creadoEn: true },
    orderBy: { creadoEn: 'asc' },
  })

  const itemsPrueba = await prisma.itemCarta.findMany({
    where: { negocioId: neg.id, nombre: { startsWith: 'Prueba' } },
    select: { id: true, nombre: true, categoria: true },
  })

  console.log(`\n  Negocio: ${neg.nombre} (${SLUG})`)
  console.log(`  Modo: ${APLICAR ? '*** APPLY (borra de verdad) ***' : 'DRY-RUN (no toca nada)'}\n`)

  if (clientes.length === 0 && itemsPrueba.length === 0 && pedidosSueltos.length === 0) {
    console.log('  No hay nada para limpiar. La base ya esta limpia.\n')
    return
  }

  console.log(`  Clientes a borrar: ${clientes.length}`)
  for (const c of clientes.slice(0, 50)) {
    console.log(
      `    - ${c.nombre.padEnd(26)} ${enmascarar(c.telefono).padEnd(14)} ` +
      `${c.creadoEn.toISOString().slice(0, 10)}  ` +
      `visitas=${c._count.visitas} pedidos=${c._count.pedidos} tokens=${c._count.tokensValidacion} tarjetas=${c._count.tarjetas}`,
    )
  }
  if (clientes.length > 50) console.log(`    ... y ${clientes.length - 50} mas`)

  if (pedidosSueltos.length > 0) {
    console.log(`\n  Pedidos de INVITADO con marcas de test: ${pedidosSueltos.length}`)
    for (const q of pedidosSueltos.slice(0, 20)) {
      console.log(`    - ${q.nombreCliente.padEnd(24)} ${enmascarar(q.telefono).padEnd(14)} ${q.tipo.padEnd(9)} ${q.estado.padEnd(11)} $${Number(q.total).toFixed(2)}  ${q.creadoEn.toISOString().slice(0, 16)}`)
    }
    if (pedidosSueltos.length > 20) console.log(`    ... y ${pedidosSueltos.length - 20} mas`)
  }

  if (itemsPrueba.length > 0) {
    console.log(`\n  Items de carta 'Prueba*': ${itemsPrueba.length}`)
    for (const i of itemsPrueba.slice(0, 20)) console.log(`    - ${i.nombre} (${i.categoria})`)
  }

  // Conteos por tabla (los que se van a borrar en cascada).
  const idsPedido = pedidosSueltos.map((q) => q.id)
  const [visitas, tokens, pedidos, tarjetas, dispositivos, notifs] = await Promise.all([
    prisma.visita.count({ where: { clienteId: { in: ids } } }),
    prisma.tokenValidacion.count({ where: { clienteId: { in: ids } } }),
    prisma.pedido.count({ where: { clienteId: { in: ids } } }),
    prisma.tarjetaClienteSucursal.count({ where: { clienteId: { in: ids } } }),
    prisma.dispositivoCliente.count({ where: { clienteId: { in: ids } } }),
    prisma.notificacionPush.count({ where: { clienteId: { in: ids } } }),
  ])

  const resumen = {
    Cliente: clientes.length, Visita: visitas, TokenValidacion: tokens, Pedido: pedidos + pedidosSueltos.length,
    TarjetaClienteSucursal: tarjetas, DispositivoCliente: dispositivos,
    NotificacionPush: notifs, ItemCartaPrueba: itemsPrueba.length,
  }

  if (!APLICAR) {
    console.log('\n  --- DRY-RUN: esto es lo que borraria ---')
    console.log('  ' + Object.entries(resumen).map(([k, v]) => `${k}: ${v}`).join(', '))
    console.log('\n  Para aplicar:  node scripts/limpiar-datos-test.cjs --apply\n')
    return
  }

  const borrado = await prisma.$transaction(async (tx) => {
    const r = {}
    r.NotificacionPush = (await tx.notificacionPush.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.DispositivoCliente = (await tx.dispositivoCliente.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.TarjetaClienteSucursal = (await tx.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.Visita = (await tx.visita.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.TokenValidacion = (await tx.tokenValidacion.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.Pedido = (await tx.pedido.deleteMany({ where: { OR: [{ clienteId: { in: ids } }, { id: { in: idsPedido } }] } })).count
    r.ItemCartaPrueba = (await tx.itemCarta.deleteMany({ where: { negocioId: neg.id, nombre: { startsWith: 'Prueba' } } })).count
    r.Cliente = (await tx.cliente.deleteMany({ where: { id: { in: ids } } })).count
    return r
  })

  console.log('\n  --- BORRADO ---')
  console.log('  ' + Object.entries(borrado).map(([k, v]) => `${k}: ${v}`).join(', '))
  console.log('')
}

main()
  .catch((e) => { console.error('  ERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
