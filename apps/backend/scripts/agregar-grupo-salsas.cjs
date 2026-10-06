/**
 * Agrega el grupo obligatorio "Salsas obligatorias" a la Hamburguesa clasica.
 *
 *   node scripts/agregar-grupo-salsas.cjs
 *
 * Idempotente: si el grupo ya existe (por nombre, en ese negocio) no lo duplica. Existe porque
 * el seed ya creo los datos y volver a correr `db:seed` entero tocaria todo lo demas; el mismo
 * bloque esta ademas en prisma/seed.ts para que un clon nuevo lo tenga desde el arranque.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const OPCIONES = [
  { nombre: 'Salsa de la casa', precioExtra: 0, orden: 1 },
  { nombre: 'BBQ', precioExtra: 200, orden: 2 },
  { nombre: 'Sin salsa', precioExtra: 0, orden: 3 },
]

;(async () => {
  const neg = await prisma.negocio.findFirst({ where: { slug: 'bar-la-esquina' }, select: { id: true } })
  if (!neg) throw new Error('no existe el negocio bar-la-esquina')

  const item = await prisma.itemCarta.findFirst({ where: { negocioId: neg.id, nombre: { contains: 'Hamburguesa' } }, select: { id: true, nombre: true } })
  if (!item) throw new Error('no encontre la Hamburguesa clasica')

  let grupo = await prisma.grupoModificador.findFirst({ where: { negocioId: neg.id, nombre: 'Salsas obligatorias' }, select: { id: true } })
  if (grupo) {
    console.log(`  el grupo ya existia (${grupo.id}), no se crea de nuevo`)
    await prisma.grupoModificador.update({
      where: { id: grupo.id },
      data: { tipo: 'UNICA_SELECCION', obligatorio: true, minSelecciones: 1, maxSelecciones: 1, orden: 99 },
    })
  } else {
    grupo = await prisma.grupoModificador.create({
      data: {
        negocioId: neg.id,
        nombre: 'Salsas obligatorias',
        descripcion: 'Elegi una salsa (o sin salsa)',
        tipo: 'UNICA_SELECCION',
        obligatorio: true,
        minSelecciones: 1,
        maxSelecciones: 1,
        orden: 99,
        opciones: { create: OPCIONES },
      },
      select: { id: true },
    })
    console.log(`  grupo creado: ${grupo.id} con ${OPCIONES.length} opciones`)
  }

  await prisma.itemCarta.update({
    where: { id: item.id },
    data: { gruposModificadores: { connect: { id: grupo.id } } },
  })
  console.log(`  ${item.nombre} -> grupo conectado`)

  const verif = await prisma.itemCarta.findUnique({
    where: { id: item.id },
    select: { nombre: true, gruposModificadores: { select: { nombre: true, obligatorio: true, minSelecciones: true, maxSelecciones: true, opciones: { select: { nombre: true, precioExtra: true }, orderBy: { orden: 'asc' } } } } },
  })
  console.log('  estado final:', JSON.stringify(verif, null, 1))
  await prisma.$disconnect()
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect().catch(() => {}); process.exit(1) })
