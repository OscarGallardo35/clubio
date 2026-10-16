/**
 * Check de la RESOLUCION DE TENANT (lib/tenant.ts).
 *
 *   node scripts/check-tenant.mts
 *
 * Es logica pura: el tenant de la URL (`X-Tenant-Slug`) y la deteccion del 403 del `TenantGuard`.
 * Lo que se protege aca son los dos bugs que ya se vieron en produccion:
 *  1. el PARPADEO: la primera request de una carga en frio salia SIN el header (el tenant se fijaba
 *     en un useEffect del padre y los efectos corren de hijo a padre), el backend la respondia con
 *     el tenant DEL TOKEN y la app mostraba un instante datos de OTRO local. `resolverTenantSincrono`
 *     tiene que dar el tenant correcto en la PRIMERA vuelta, en las dos formas de navegacion.
 *  2. el 403: se detecta por el `code` estable (cuando exista) y, mientras no exista, por el texto.
 */
import {
  CODIGO_TENANT_MISMATCH,
  esTenantMismatch,
  resolverTenantSincrono,
  tenantDelPath,
  tenantDelSubdominio,
} from '../lib/tenant.ts'

let ok = 0
const fallas: string[] = []

function chk(nombre: string, cond: boolean, detalle = '') {
  if (cond) {
    ok++
    console.log(`  OK    ${nombre}`)
  } else {
    fallas.push(nombre)
    console.log(`  FALLA ${nombre}${detalle ? `  -> ${detalle}` : ''}`)
  }
}
function igual(nombre: string, real: unknown, esperado: unknown) {
  chk(nombre, JSON.stringify(real) === JSON.stringify(esperado), `real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`)
}

/* ------------------------------------------------------------------ *
 * resolveTenantSincrono: lo que va en el header de CADA request
 * ------------------------------------------------------------------ */

console.log('--- forma PATH: app.clubio.lat/<slug>/... ---')
igual('club del tenant', resolverTenantSincrono('/nonona-lomos/club', 'app.clubio.lat'), 'nonona-lomos')
igual('menu del tenant', resolverTenantSincrono('/que-lomitos/menu', 'app.clubio.lat'), 'que-lomitos')
igual('tarjeta con tenant en el path', resolverTenantSincrono('/nonona-lomos/tarjeta', 'app.clubio.lat'), 'nonona-lomos')
igual('checkout del tenant', resolverTenantSincrono('/nonona-lomos/checkout', 'app.clubio.lat'), 'nonona-lomos')
// Publicas con tenant en el path (carta/menu, pedido por link, verificacion, premio).
igual('pedido por link (publica)', resolverTenantSincrono('/nonona-lomos/pedido/tok-123', 'app.clubio.lat'), 'nonona-lomos')
igual('verificacion por link (publica)', resolverTenantSincrono('/nonona-lomos/verificar/tok-123', 'app.clubio.lat'), 'nonona-lomos')
igual('premio por link (publica)', resolverTenantSincrono('/nonona-lomos/premio/tok-123', 'app.clubio.lat'), 'nonona-lomos')
// www/api tambien son hosts reservados: manda el path.
igual('host www: manda el path', resolverTenantSincrono('/nonona-lomos/club', 'www.clubio.lat'), 'nonona-lomos')

console.log('\n--- forma SUBDOMINIO: <slug>.clubio.lat/... ---')
// El caso que fija el ORDEN (subdominio antes que path): en el subdominio la URL del navegador puede
// NO traer el slug porque el middleware reescribe a /[tenant]/club sin cambiar la barra de
// direcciones. Con el path primero, tenantDelPath('/club') devolveria 'club' y el header saldria mal
// en TODAS las requests.
igual('entrada al club sin slug en el path', resolverTenantSincrono('/club', 'nonona-lomos.clubio.lat'), 'nonona-lomos')
igual('entrada al menu sin slug en el path', resolverTenantSincrono('/menu', 'nonona-lomos.clubio.lat'), 'nonona-lomos')
igual('raiz del subdominio (redirige al menu)', resolverTenantSincrono('/', 'nonona-lomos.clubio.lat'), 'nonona-lomos')
igual('navegacion interna (los links ya traen el slug)', resolverTenantSincrono('/nonona-lomos/tarjeta', 'nonona-lomos.clubio.lat'), 'nonona-lomos')
chk('el path de la raiz NO se confunde con un local',
  resolverTenantSincrono('/club', 'nonona-lomos.clubio.lat') !== 'club')
igual('publicas en el subdominio', resolverTenantSincrono('/verificar/tok-1', 'nonona-lomos.clubio.lat'), 'nonona-lomos')

console.log('\n--- rutas de la RAIZ sin tenant: comportamiento de HOY (null) ---')
// Ahi el ApiClient cae al tenant que fija el BrandingProvider: no cambia nada.
for (const ruta of ['/tarjeta', '/historial', '/seleccionar-sucursal', '/offline', '/dev', '/']) {
  igual(`path ${ruta} sin tenant`, resolverTenantSincrono(ruta, 'app.clubio.lat'), null)
  igual(`subdominio reservado + ${ruta}`, resolverTenantSincrono(ruta, 'www.clubio.lat'), null)
}
igual('dominio pelado (2 labels)', resolverTenantSincrono('/nonona-lomos/club', 'clubio.lat'), 'nonona-lomos')
igual('localhost', resolverTenantSincrono('/nonona-lomos/club', 'localhost'), 'nonona-lomos')
igual('localhost en una ruta de la raiz', resolverTenantSincrono('/tarjeta', 'localhost'), null)
igual('sin hostname', resolverTenantSincrono('/nonona-lomos/club', null), 'nonona-lomos')
igual('sin pathname', resolverTenantSincrono(null, 'app.clubio.lat'), null)
igual('sin nada', resolverTenantSincrono(undefined, undefined), null)

console.log('\n--- piezas de base ---')
igual('tenantDelSubdominio de un tenant', tenantDelSubdominio('nonona-lomos.clubio.lat'), 'nonona-lomos')
igual('tenantDelSubdominio reservado (app)', tenantDelSubdominio('app.clubio.lat'), null)
igual('tenantDelSubdominio reservado (staff)', tenantDelSubdominio('staff.clubio.lat'), null)
igual('tenantDelSubdominio reservado (api)', tenantDelSubdominio('api.clubio.lat'), null)
igual('tenantDelPath del club', tenantDelPath('/nonona-lomos/club'), 'nonona-lomos')
igual('tenantDelPath de la tarjeta raiz', tenantDelPath('/tarjeta'), null)
igual('tenantDelPath del historial raiz', tenantDelPath('/historial'), null)

/* ------------------------------------------------------------------ *
 * esTenantMismatch: el 403 del TenantGuard
 * ------------------------------------------------------------------ */

console.log('\n--- 403 del TenantGuard: criterio ---')
const MENSAJE_BACKEND = 'El tenant del token no coincide con la solicitud'
// El body REAL que arma Nest para el ForbiddenException del TenantGuard: NO trae `code`.
const BODY_REAL = { statusCode: 403, message: MENSAJE_BACKEND, error: 'Forbidden' }

chk('el code pedido al backend es el contrato acordado', CODIGO_TENANT_MISMATCH === 'TENANT_MISMATCH')
igual('403 con el texto del backend (lo unico que hay hoy)', esTenantMismatch(403, MENSAJE_BACKEND, BODY_REAL), true)
igual('403 con el code estable (el dia que el backend lo mande)', esTenantMismatch(403, 'cualquier cosa', { code: 'TENANT_MISMATCH' }), true)
igual('el code gana aunque el mensaje cambie de idioma', esTenantMismatch(403, 'Tenant mismatch', { code: 'TENANT_MISMATCH' }), true)
igual('403 con otro code y otro texto NO es mismatch', esTenantMismatch(403, 'No tenes permiso', { code: 'FORBIDDEN' }), false)
// El `error: 'Forbidden'` del body lo comparte CUALQUIER 403 de la API: no sirve como criterio.
igual('el error "Forbidden" del body no alcanza', esTenantMismatch(403, 'No tenes permiso', { statusCode: 403, error: 'Forbidden' }), false)
igual('403 sin mensaje', esTenantMismatch(403, null), false)
igual('401 con el texto no es mismatch', esTenantMismatch(401, MENSAJE_BACKEND), false)
igual('400 con el texto no es mismatch', esTenantMismatch(400, MENSAJE_BACKEND), false)
igual('un 400 del negocio no es mismatch', esTenantMismatch(400, 'Alcanzaste el limite de visitas por dia'), false)
igual('el 404 de "falta el tenant" NO es mismatch (es reintentable)',
  esTenantMismatch(404, 'Falta el tenant (X-Tenant-Slug) para esta operacion'), false)

console.log(`\n  TOTAL: ${ok} OK, ${fallas.length} FALLA`)
if (fallas.length) {
  console.log('  FALLARON: ' + fallas.join(' | '))
  process.exit(1)
}
