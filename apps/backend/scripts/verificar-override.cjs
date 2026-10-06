/**
 * Verifica el override de precio por sucursal (Opcion A).
 *
 *   node scripts/verificar-override.cjs
 *
 * Vive en apps/backend para compartir el contexto del backend, aunque no usa Prisma: todo
 * pasa por la API publica, como lo haria la PWA.
 *
 * Pasos: login del dueno -> elegir un item real de la carta -> crear el override en norte ->
 * comprobar que norte lo respeta y centro no -> borrarlo -> comprobar que norte vuelve al
 * precio global. Si algo se corta en el medio, el finally borra el override igual.
 */
const API = (process.env.API_URL || 'http://localhost:3000/api').replace(/\/$/, '')
const NEGOCIO = process.env.TENANT || 'bar-la-esquina'
const ITEM_BUSCADO = process.env.ITEM || 'Coca-Cola 500ml'
const PRECIO_OVERRIDE = Number(process.env.PRECIO_OVERRIDE || 9999)
const EMAIL = process.env.SEED_DUENO_EMAIL || 'carlos@barlaesquina.com'
const PASSWORD = process.env.SEED_DUENO_PASSWORD || 'dueno123456'

let ok = 0
const fallas = []
function chk(nombre, cond, detalle = '') {
  if (cond) { ok++; console.log(`  OK    ${nombre}`) }
  else { fallas.push(nombre); console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`) }
}
function igual(nombre, real, esperado) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

async function req(metodo, ruta, cuerpo, token) {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': NEGOCIO }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(API + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  let json
  try { json = JSON.parse(texto) } catch { json = texto }
  return { status: r.status, body: json }
}

/** Items de la carta de una sucursal (via API publica). */
async function itemsDeCarta(sucursalSlug) {
  const { status, body } = await req('GET', `/carta?sucursalSlug=${encodeURIComponent(sucursalSlug)}`)
  if (status !== 200) throw new Error(`GET /carta?sucursalSlug=${sucursalSlug} -> ${status} ${JSON.stringify(body).slice(0, 200)}`)
  return (body.categorias || []).flatMap((c) => c.items || [])
}

/** El item buscado en una sucursal, leido de la carta publica. */
async function precioEn(sucursalSlug, itemId) {
  const { status, body } = await req('GET', `/carta?sucursalSlug=${encodeURIComponent(sucursalSlug)}`)
  if (status !== 200) throw new Error(`GET /carta?sucursalSlug=${sucursalSlug} -> ${status} ${JSON.stringify(body).slice(0, 200)}`)
  for (const cat of body.categorias || []) {
    for (const it of cat.items || []) if (it.id === itemId) return it
  }
  throw new Error(`el item ${itemId} no aparece en la carta de ${sucursalSlug}`)
}

;(async () => {
  console.log(`API: ${API} | negocio: ${NEGOCIO}`)

  // a) login del dueno
  const login = await req('POST', '/auth/dueno/login', { negocioSlug: NEGOCIO, email: EMAIL, password: PASSWORD })
  if (login.status !== 201 || !login.body.accessToken) {
    console.error(`  login -> ${login.status} ${JSON.stringify(login.body).slice(0, 300)}`)
    process.exit(1)
  }
  const token = login.body.accessToken

  // b) un item real de la carta
  const itemsCentro = await itemsDeCarta('centro')
  const item = itemsCentro.find((i) => i.nombre === ITEM_BUSCADO) || itemsCentro[0]
  if (!item) throw new Error(`la carta de centro vino sin items (${itemsCentro.length})`)
  const global = item.precio
  console.log(`  item: ${item.nombre} (id ${item.id}) | precio global ${global}`)

  // sucursal norte, por la ruta publica
  const pub = await req('GET', `/negocios/publico/${NEGOCIO}`)
  const sucursales = pub.body.sucursales || []
  const norte = sucursales.find((s) => s.slug === 'norte') || sucursales.find((s) => !s.esPrincipal)
  if (!norte) {
    console.error(`  no encontre 'norte': ${JSON.stringify(sucursales).slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`  norte: id ${norte.id} (slug ${norte.slug})`)

  let overrideCreado = false
  try {
    // c) crear el override
    const creado = await req('POST', `/sucursales/${norte.id}/items-override`, { itemCartaId: item.id, precio: PRECIO_OVERRIDE }, token)
    if (creado.status >= 400) throw new Error(`POST items-override -> ${creado.status} ${JSON.stringify(creado.body).slice(0, 300)}`)
    overrideCreado = true

    // d) norte lo respeta
    const enNorte = await precioEn('norte', item.id)
    igual(`norte respeta el override (${PRECIO_OVERRIDE})`, enNorte.precio, PRECIO_OVERRIDE)

    // e) centro sigue con el global
    const enCentro = await precioEn('centro', item.id)
    igual(`centro sigue con el global (${global})`, enCentro.precio, global)

    // f) borrar el override
    const borrado = await req('DELETE', `/sucursales/${norte.id}/items-override/${item.id}`, undefined, token)
    chk('DELETE del override responde OK', borrado.status < 400, `status=${borrado.status} ${JSON.stringify(borrado.body).slice(0, 200)}`)
    if (borrado.status < 400) overrideCreado = false

    // g) norte vuelve al global y el override ya no esta listado
    const despues = await precioEn('norte', item.id)
    igual(`tras borrar, norte vuelve al global (${global})`, despues.precio, global)
    const listado = await req('GET', `/sucursales/${norte.id}/items-override`, undefined, token)
    const quedan = JSON.stringify(listado.body).includes(item.id)
    chk('el override ya no figura en el listado', !quedan, JSON.stringify(listado.body).slice(0, 200))
  } catch (e) {
    // Sin wrapper: el mensaje tal cual.
    console.error('  ERROR:', e && e.message ? e.message : e)
    fallas.push('excepcion: ' + (e && e.message ? e.message : e))
  } finally {
    if (overrideCreado) {
      const limpieza = await req('DELETE', `/sucursales/${norte.id}/items-override/${item.id}`, undefined, token).catch(() => null)
      console.log(`  (limpieza de emergencia del override: ${limpieza ? limpieza.status : 'sin respuesta'})`)
    }
  }

  console.log(`\n${fallas.length === 0 ? 'TODO OK' : 'HAY FALLAS'}: ${ok} aserciones OK, ${fallas.length} fallas`)
  if (fallas.length) console.log(fallas.map((f) => `  - ${f}`).join('\n'))
  process.exit(fallas.length === 0 ? 0 : 1)
})()
