/**
 * Limpia los datos de prueba que dejan los harness de integracion y las corridas manuales.
 *
 *   node scripts/limpiar-datos-test.cjs            # DRY-RUN: muestra que haria, no toca nada
 *   node scripts/limpiar-datos-test.cjs --apply    # ejecuta de verdad
 *
 * Lee el .env de la raiz solo (si DATABASE_URL no esta en el entorno), asi que corre con:
 *   pnpm --filter backend exec dotenv -e ../../.env -- node scripts/limpiar-datos-test.cjs
 * o directo:  node scripts/limpiar-datos-test.cjs
 *
 * QUE LIMPIA (siempre dentro del negocio de bar-la-esquina)
 * - Clientes de prueba por NOMBRE: 'E2E %', 'Prueba %', 'Harness %', 'Cliente Test %', 'Test %',
 *   'ZZ %' y 'Oscar Gabriel'.
 * - Clientes por TELEFONO: los prefijos que usan los harness ('+54911123400...', '+549112535...').
 * - En cascada: Visita, TokenValidacion, Pedido, TarjetaClienteSucursal, DispositivoCliente y
 *   NotificacionPush de esos clientes (mas los pedidos de INVITADO con las mismas marcas).
 * - Items de carta cuyo nombre empiece con 'Prueba' o 'ZZ'.
 * - Empleados que NO estan en el seed -> se DESACTIVAN (mismo efecto que el DELETE del panel:
 *   `activo:false` + `eliminadoEn` + se les borran las sesiones). No se borra la fila: las tablas
 *   que la referencian (turnos, visitas validadas, encargado del dia) romperian el borrado.
 * - Sucursales que NO estan en el seed -> `activa:false` (idem: no se borra la fila).
 * - Pedidos que quedaron ACTIVOS -> se cancelan con motivo (no se borran: son historial).
 * - Tokens de validacion VIVOS (`usado:false` y sin vencer) -> se borran: son solicitudes que
 *   nadie fue a aprobar.
 *
 * QUE NO TOCA NUNCA
 * - El negocio bar-la-esquina, sus 2 sucursales del seed (centro, norte) ni ConfiguracionClub.
 * - Los 4 empleados del seed ni los 13 items de la carta del seed.
 * - EventoAuditoria: queda como historial. La limpieza deja su propia fila ahi.
 *
 * DOS TRAMPAS YA PAGADAS (no repetirlas)
 * 1. Los `PREFIJOS_TEL` de la version anterior eran los numeros YA ENMASCARADOS ('+5****85'):
 *    un telefono nunca contiene `*`, asi que ese filtro NO matcheaba nada. La limpieza "corria
 *    bien" y dejaba todos los clientes de telefono. Los de abajo son los digitos reales,
 *    verificados contra la base (y se comprobo que ninguno de los 22 clientes legitimos cae ahi).
 * 2. `Visita.aprobadoEn` es OBLIGATORIO (no nullable): no existen "visitas sin aprobar" como
 *    filas. Lo que queda pendiente son los TOKENS sin usar, y eso es lo que se limpia.
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

/** El seed: lo que hay que dejar intacto. */
const SEED_SUCURSALES = ['centro', 'norte']
const SEED_EMPLEADOS = ['Carlos Dueño', 'María Encargada', 'Juan Cajero', 'Pedro Mesero']

const PREFIJOS_NOMBRE = ['E2E ', 'Prueba ', 'Harness ', 'Cliente Test ', 'Test ', 'ZZ ']
const NOMBRES_EXACTOS = ['Oscar Gabriel']
/** Digitos REALES (sin enmascarar) de los rangos que usan los harness. */
const PREFIJOS_TEL = ['+54911123400', '+549112535']

const PEDIDOS_ACTIVOS = ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO']
const MOTIVO_CANCELACION = 'Cancelado en la limpieza pre-demo'

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
      ...PREFIJOS_NOMBRE.map((p) => ({ nombre: { startsWith: p } })),
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
        ...PREFIJOS_NOMBRE.map((p) => ({ nombreCliente: { startsWith: p } })),
        ...PREFIJOS_TEL.map((p) => ({ telefono: { startsWith: p } })),
      ],
    },
    select: { id: true, nombreCliente: true, telefono: true, tipo: true, estado: true, total: true, creadoEn: true },
    orderBy: { creadoEn: 'asc' },
  })

  const itemsPrueba = await prisma.itemCarta.findMany({
    where: { negocioId: neg.id, OR: [{ nombre: { startsWith: 'Prueba' } }, { nombre: { startsWith: 'ZZ' } }] },
    select: { id: true, nombre: true, categoria: true },
  })

  const empleadosFuera = (await prisma.empleado.findMany({
    where: { negocioId: neg.id },
    select: { id: true, nombre: true, rol: true, activo: true, eliminadoEn: true },
  })).filter((e) => !SEED_EMPLEADOS.includes(e.nombre))

  const sucursalesFuera = (await prisma.sucursal.findMany({
    where: { negocioId: neg.id },
    select: { id: true, nombre: true, slug: true, activa: true },
  })).filter((s) => !SEED_SUCURSALES.includes(s.slug))

  const pedidosActivos = await prisma.pedido.findMany({
    where: { negocioId: neg.id, estado: { in: PEDIDOS_ACTIVOS } },
    select: { id: true, estado: true, creadoEn: true, nombreCliente: true, sucursalId: true },
    orderBy: { creadoEn: 'asc' },
  })

  const tokensVivos = await prisma.tokenValidacion.findMany({
    where: { negocioId: neg.id, usado: false, expiraEn: { gt: new Date() } },
    select: { token: true, creadoEn: true, expiraEn: true, clienteId: true },
  })

  console.log(`\n  Negocio: ${neg.nombre} (${SLUG})`)
  console.log(`  Modo: ${APLICAR ? '*** APPLY (escribe de verdad) ***' : 'DRY-RUN (no toca nada)'}\n`)

  const nada =
    clientes.length === 0 && itemsPrueba.length === 0 && pedidosSueltos.length === 0 &&
    empleadosFuera.length === 0 && sucursalesFuera.length === 0 && pedidosActivos.length === 0 &&
    tokensVivos.length === 0
  if (nada) {
    console.log('  No hay nada para limpiar. La base ya esta limpia.\n')
    return
  }

  console.log(`  Clientes de prueba a borrar: ${clientes.length}`)
  for (const c of clientes.slice(0, 50)) {
    console.log(
      `    - ${(c.nombre ?? '').padEnd(24)} ${enmascarar(c.telefono).padEnd(14)} ` +
      `${c.creadoEn.toISOString().slice(0, 10)}  ` +
      `visitas=${c._count.visitas} pedidos=${c._count.pedidos} tokens=${c._count.tokensValidacion} tarjetas=${c._count.tarjetas}`,
    )
  }
  if (clientes.length > 50) console.log(`    ... y ${clientes.length - 50} mas`)

  if (pedidosSueltos.length > 0) {
    console.log(`\n  Pedidos de INVITADO con marcas de test: ${pedidosSueltos.length}`)
    for (const q of pedidosSueltos.slice(0, 20)) {
      console.log(`    - ${(q.nombreCliente ?? '').padEnd(22)} ${enmascarar(q.telefono).padEnd(14)} ${q.tipo.padEnd(9)} ${q.estado.padEnd(11)} $${Number(q.total).toFixed(2)}  ${q.creadoEn.toISOString().slice(0, 16)}`)
    }
    if (pedidosSueltos.length > 20) console.log(`    ... y ${pedidosSueltos.length - 20} mas`)
  }

  if (itemsPrueba.length > 0) {
    console.log(`\n  Items de carta de prueba: ${itemsPrueba.length}`)
    for (const i of itemsPrueba.slice(0, 20)) console.log(`    - ${i.nombre} (${i.categoria})`)
  }

  if (empleadosFuera.length > 0) {
    console.log(`\n  Empleados fuera del seed a DESACTIVAR: ${empleadosFuera.length} (el seed tiene ${SEED_EMPLEADOS.length})`)
    for (const e of empleadosFuera) console.log(`    - ${e.nombre} (${e.rol}) activo=${e.activo}`)
  }

  if (sucursalesFuera.length > 0) {
    console.log(`\n  Sucursales fuera del seed a DESACTIVAR: ${sucursalesFuera.length} (el seed tiene ${SEED_SUCURSALES.join(', ')})`)
    for (const s of sucursalesFuera) console.log(`    - ${s.nombre} (/${s.slug}) activa=${s.activa}`)
  }

  if (pedidosActivos.length > 0) {
    console.log(`\n  Pedidos ACTIVOS a cancelar: ${pedidosActivos.length}  ("${MOTIVO_CANCELACION}")`)
    for (const p of pedidosActivos.slice(0, 20)) console.log(`    - ${p.estado} ${p.creadoEn.toISOString().slice(0, 16)} ${p.nombreCliente ?? ''}`)
  }

  if (tokensVivos.length > 0) {
    console.log(`\n  Tokens de validacion VIVOS a borrar: ${tokensVivos.length}`)
    for (const t of tokensVivos.slice(0, 20)) console.log(`    - ${t.creadoEn.toISOString().slice(0, 16)} vence ${t.expiraEn.toISOString().slice(0, 16)}`)
  }

  const idsPedido = pedidosSueltos.map((q) => q.id)
  const antes = {
    Cliente: await prisma.cliente.count({ where: { negocioId: neg.id } }),
    Pedido: await prisma.pedido.count({ where: { negocioId: neg.id } }),
    Visita: await prisma.visita.count({ where: { negocioId: neg.id } }),
    TokenValidacion: await prisma.tokenValidacion.count({ where: { negocioId: neg.id } }),
    ItemCarta: await prisma.itemCarta.count({ where: { negocioId: neg.id } }),
    EmpleadoActivo: await prisma.empleado.count({ where: { negocioId: neg.id, activo: true, eliminadoEn: null } }),
    SucursalActiva: await prisma.sucursal.count({ where: { negocioId: neg.id, activa: true } }),
  }
  console.log('\n  ANTES: ' + Object.entries(antes).map(([k, v]) => `${k}=${v}`).join(' '))

  if (!APLICAR) {
    console.log('\n  --- DRY-RUN: no se toco nada ---')
    console.log('  Para aplicar:  node scripts/limpiar-datos-test.cjs --apply\n')
    return
  }

  const escrito = await prisma.$transaction(async (tx) => {
    const r = {}
    r.NotificacionPush = (await tx.notificacionPush.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.DispositivoCliente = (await tx.dispositivoCliente.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.TarjetaClienteSucursal = (await tx.tarjetaClienteSucursal.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.Visita = (await tx.visita.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.TokenValidacionDeClientes = (await tx.tokenValidacion.deleteMany({ where: { clienteId: { in: ids } } })).count
    r.TokenValidacionVivos = (await tx.tokenValidacion.deleteMany({ where: { negocioId: neg.id, usado: false, expiraEn: { gt: new Date() } } })).count
    r.Pedido = (await tx.pedido.deleteMany({ where: { OR: [{ clienteId: { in: ids } }, { id: { in: idsPedido } }] } })).count
    r.ItemCartaPrueba = (await tx.itemCarta.deleteMany({ where: { negocioId: neg.id, OR: [{ nombre: { startsWith: 'Prueba' } }, { nombre: { startsWith: 'ZZ' } }] } })).count
    r.Cliente = (await tx.cliente.deleteMany({ where: { id: { in: ids } } })).count

    // Empleados fuera del seed: mismo efecto que el DELETE del panel (no se borra la fila).
    if (empleadosFuera.length) {
      const idsEmp = empleadosFuera.map((e) => e.id)
      await tx.sesionEmpleado.deleteMany({ where: { empleadoId: { in: idsEmp } } })
      await tx.sesionDueno.deleteMany({ where: { empleadoId: { in: idsEmp } } })
      r.Empleado = (await tx.empleado.updateMany({
        where: { id: { in: idsEmp } },
        data: { activo: false, eliminadoEn: new Date() },
      })).count
    }
    if (sucursalesFuera.length) {
      r.Sucursal = (await tx.sucursal.updateMany({
        where: { id: { in: sucursalesFuera.map((s) => s.id) } },
        data: { activa: false },
      })).count
    }
    if (pedidosActivos.length) {
      r.PedidoCancelado = (await tx.pedido.updateMany({
        where: { id: { in: pedidosActivos.map((p) => p.id) } },
        data: { estado: 'CANCELADO', motivoRechazo: MOTIVO_CANCELACION },
      })).count
    }

    await tx.eventoAuditoria.create({
      data: {
        negocioId: neg.id,
        accion: 'limpieza.datos_test',
        detalle: {
          clientes: r.Cliente, pedidos: r.Pedido, visitas: r.Visita,
          tokens: (r.TokenValidacionDeClientes ?? 0) + (r.TokenValidacionVivos ?? 0),
          items: r.ItemCartaPrueba, empleados: r.Empleado ?? 0, sucursales: r.Sucursal ?? 0,
          pedidosCancelados: r.PedidoCancelado ?? 0,
        },
      },
    })
    return r
  })

  console.log('\n  --- ESCRITO ---')
  console.log('  ' + Object.entries(escrito).map(([k, v]) => `${k}=${v}`).join(' '))

  const despues = {
    Cliente: await prisma.cliente.count({ where: { negocioId: neg.id } }),
    Pedido: await prisma.pedido.count({ where: { negocioId: neg.id } }),
    Visita: await prisma.visita.count({ where: { negocioId: neg.id } }),
    TokenValidacion: await prisma.tokenValidacion.count({ where: { negocioId: neg.id } }),
    ItemCarta: await prisma.itemCarta.count({ where: { negocioId: neg.id } }),
    EmpleadoActivo: await prisma.empleado.count({ where: { negocioId: neg.id, activo: true, eliminadoEn: null } }),
    SucursalActiva: await prisma.sucursal.count({ where: { negocioId: neg.id, activa: true } }),
  }
  console.log('  DESPUES: ' + Object.entries(despues).map(([k, v]) => `${k}=${v}`).join(' '))
  console.log('')
}

main()
  .catch((e) => { console.error('  ERROR:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
