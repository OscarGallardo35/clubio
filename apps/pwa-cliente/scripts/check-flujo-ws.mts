/**
 * Harness del flujo QR #2 contra el BACKEND REAL (HTTP + WebSocket).
 *
 *   node scripts/check-flujo-ws.ts        (con el backend levantado en :3000)
 *
 * Usa el mismo `createSocket` de @repo/api-client que la PWA. En node no hay
 * cookies, asi que la identidad va por Authorization: Bearer (el ApiClient hace
 * lo mismo cuando tiene token).
 *
 * Camino verificado:
 *   1. registrar cliente            -> accessToken
 *   2. POST /visitas/solicitar      -> token de visita
 *   3. conectar el WS con auth.token
 *   4. aprobar desde staff (PIN)
 *   5. el cliente recibe visita:aprobada  y GET /visitas/estado/:token = APROBADA
 *   6. repetir la solicitud         -> 400 "espera N horas" (clasificado, no error)
 *   7. segunda visita: rechazo      -> visita:rechazada + estado RECHAZADA
 */
import { io } from 'socket.io-client'
import { ESTADO_INICIAL, clasificarRechazoDeSolicitud, visitaReducir } from '../lib/visita-maquina.ts'
import type { EventoFlujo } from '../lib/visita-maquina.ts'

/**
 * El socket se arma con `io` directo y NO con createSocket de @repo/api-client:
 * ese package usa una parameter property (`constructor(public status: number)`)
 * que node en modo strip-only rechaza
 * (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). El handshake es el mismo que produce el
 * factory: `auth: { token }` + websocket (es lo que lee el gateway).
 */
type SocketMin = ReturnType<typeof io>
const crearSocket = (token: string): SocketMin =>
  io(`${API}/visitas`, {
    auth: { token },
    transports: ['websocket'],
    withCredentials: true,
    reconnection: false,
  })

const API = 'http://localhost:3000'
const TENANT = process.env.TENANT ?? 'bar-la-esquina'
const PIN_ENCARGADA = process.env.PIN ?? '1111'

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

async function http<T>(ruta: string, opts: { metodo?: string; cuerpo?: unknown; token?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Tenant-Slug': TENANT }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  const res = await fetch(`${API}${ruta}`, {
    method: opts.metodo ?? 'GET',
    headers,
    ...(opts.cuerpo === undefined ? {} : { body: JSON.stringify(opts.cuerpo) }),
  })
  const texto = await res.text()
  let data: any = null
  try {
    data = texto ? JSON.parse(texto) : null
  } catch {
    data = texto
  }
  return { status: res.status, data }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Espera un evento del socket con timeout (ms). Devuelve null si no llego. */
function esperarEvento(socket: SocketMin, evento: string, ms: number) {
  return new Promise<any>((resolve) => {
    const t = setTimeout(() => {
      socket.off(evento, manejador)
      resolve(null)
    }, ms)
    function manejador(payload: any) {
      clearTimeout(t)
      socket.off(evento, manejador)
      resolve(payload ?? {})
    }
    socket.on(evento, manejador)
  })
}

async function main() {
  console.log(`=== harness del flujo QR #2 (backend ${API}, tenant ${TENANT}) ===\n`)

  // 1) registrar cliente
  const telefono = '+54911' + String(Date.now()).slice(-6)
  const reg = await http('/api/auth/cliente/registrar', {
    metodo: 'POST',
    cuerpo: { nombre: 'Harness Flujo', telefono, negocioSlug: TENANT },
  })
  chk('registrar cliente (201)', reg.status === 201, `status=${reg.status} ${JSON.stringify(reg.data).slice(0, 120)}`)
  const accessToken: string = reg.data?.accessToken
  chk('devuelve accessToken', typeof accessToken === 'string' && accessToken.length > 20)

  // 2) solicitar visita
  const sol = await http('/api/visitas/solicitar', { metodo: 'POST', cuerpo: { sucursalSlug: 'norte' }, token: accessToken })
  chk('solicitar visita (201)', sol.status === 201, `status=${sol.status} ${JSON.stringify(sol.data).slice(0, 140)}`)
  const tokenVisita: string = sol.data?.token
  const expiraEn: string = sol.data?.expiraEn
  chk('devuelve token de visita', typeof tokenVisita === 'string' && tokenVisita.length > 10)
  chk('devuelve expiraEn', typeof expiraEn === 'string' && !Number.isNaN(Date.parse(expiraEn)), `expiraEn=${expiraEn}`)
  const vidaMs = Date.parse(expiraEn) - Date.now()
  chk('el token vive ~5 min', vidaMs > 4 * 60_000 && vidaMs <= 5 * 60_000 + 5000, `vida=${Math.round(vidaMs / 1000)}s`)
  chk('informa la sucursal de la solicitud', sol.data?.sucursal?.slug === 'norte', `sucursal=${JSON.stringify(sol.data?.sucursal)}`)
chk('el mensaje de WhatsApp trae el token (Ref: ...)', /Ref:\s*\S+/.test(sol.data?.mensajeWhatsApp ?? ''), `mensaje=${sol.data?.mensajeWhatsApp}`)
chk('el mensaje incluye el link de validacion', /validar\?ref=/.test(sol.data?.mensajeWhatsApp ?? ''), `mensaje=${sol.data?.mensajeWhatsApp}`)
chk('urlValidacion viene completa', /validar\?ref=\S+/.test(sol.data?.urlValidacion ?? ''), `url=${sol.data?.urlValidacion}`)
chk('la url de validacion usa el MISMO token', (sol.data?.urlValidacion ?? '').includes(tokenVisita), `url=${sol.data?.urlValidacion}`)

  // idempotencia: pedir de nuevo devuelve el MISMO token
  const sol2 = await http('/api/visitas/solicitar', { metodo: 'POST', cuerpo: { sucursalSlug: 'norte' }, token: accessToken })
  chk('re-solicitar reutiliza el token (reutilizado=true)', sol2.data?.token === tokenVisita && sol2.data?.reutilizado === true, `mismo=${sol2.data?.token === tokenVisita} reutilizado=${sol2.data?.reutilizado}`)

  // 3) WS del cliente con auth.token
  const socket = crearSocket(accessToken)
  const conectado = await esperarEvento(socket, 'connect', 5000)
  chk('el WS conecta con auth.token', conectado !== null, 'timeout de 5s')

  // 4) el staff aprueba
  const login = await http('/api/auth/empleado/login', { metodo: 'POST', cuerpo: { negocioSlug: TENANT, pin: PIN_ENCARGADA } })
  chk('login de staff por PIN', login.status === 201 || login.status === 200, `status=${login.status} ${JSON.stringify(login.data).slice(0, 120)}`)
  const tokenStaff: string = login.data?.accessToken ?? login.data?.token
  chk('el staff tiene token', typeof tokenStaff === 'string' && tokenStaff.length > 20)

  const esperaAprobada = esperarEvento(socket, 'visita:aprobada', 8000)
  const apro = await http(`/api/visitas/aprobar/${tokenVisita}`, { metodo: 'POST', cuerpo: {}, token: tokenStaff })
  chk('el staff aprueba (201)', apro.status === 201 || apro.status === 200, `status=${apro.status} ${JSON.stringify(apro.data).slice(0, 160)}`)

  // 5) el cliente recibe el evento
  const payload = await esperaAprobada
  chk('el cliente RECIBE visita:aprobada', payload !== null, 'timeout de 8s')
  chk('el payload trae sellosActuales', typeof payload?.sellosActuales === 'number', `payload=${JSON.stringify(payload)}`)
  chk('el payload trae premioDesbloqueado', typeof payload?.premioDesbloqueado === 'boolean')

  // el reducer con esto llega a 'aprobada' con los sellos del payload
  let flujo = visitaReducir(ESTADO_INICIAL, { tipo: 'SOLICITADA', token: tokenVisita, expiraEn, sucursalId: null })
  flujo = visitaReducir(flujo, {
    tipo: 'WS_APROBADA',
    sellosActuales: payload?.sellosActuales ?? 0,
    premioDesbloqueado: payload?.premioDesbloqueado === true,
  } as EventoFlujo)
  chk('el reducer queda en aprobada con esos sellos', flujo.paso === 'aprobada' && flujo.sellos?.sellosActuales === payload?.sellosActuales, `paso=${flujo.paso} sellos=${JSON.stringify(flujo.sellos)}`)

  // y el estado por HTTP coincide (es el camino del polling)
  const estado = await http(`/api/visitas/estado/${tokenVisita}`, { token: accessToken })
  chk('GET estado = APROBADA (camino del polling)', estado.data?.estado === 'APROBADA', `estado=${estado.data?.estado}`)
  chk('estado trae los mismos sellos', estado.data?.sellosActuales === payload?.sellosActuales, `estado=${estado.data?.sellosActuales} ws=${payload?.sellosActuales}`)

  // 6) repetir la solicitud: 400 "espera N horas" y se clasifica, no es error
  const repetida = await http('/api/visitas/solicitar', { metodo: 'POST', cuerpo: { sucursalSlug: 'norte' }, token: accessToken })
  chk('re-solicitar tras aprobar da 400', repetida.status === 400, `status=${repetida.status}`)
  const clasif = clasificarRechazoDeSolicitud(repetida.data?.message)
  chk('se clasifica como esperaHoras (no error)', clasif.motivo === 'esperaHoras', `motivo=${clasif.motivo} mensaje=${repetida.data?.message}`)
  chk('extrae las horas que faltan', clasif.faltanHoras === 4, `faltanHoras=${clasif.faltanHoras} (seed: 4)`)

  // 7) rechazo por WS en otra sucursal (centro), que no tiene el limite diario consumido
  const cliente2 = await http('/api/auth/cliente/registrar', {
    metodo: 'POST',
    cuerpo: { nombre: 'Harness Rechazo', telefono: '+54911' + String(Date.now() + 7).slice(-6), negocioSlug: TENANT },
  })
  const token2: string = cliente2.data?.accessToken
  const solC = await http('/api/visitas/solicitar', { metodo: 'POST', cuerpo: { sucursalSlug: 'centro' }, token: token2 })
  chk('segunda solicitud (centro) ok', solC.status === 201, `status=${solC.status}`)
  const socket2 = crearSocket(token2)
  await esperarEvento(socket2, 'connect', 5000)
  const esperaRechazo = esperarEvento(socket2, 'visita:rechazada', 8000)
  const rech = await http(`/api/visitas/rechazar/${solC.data.token}`, { metodo: 'POST', cuerpo: { motivo: 'Harness: prueba de rechazo' }, token: tokenStaff })
  chk('el staff rechaza', rech.status === 201 || rech.status === 200, `status=${rech.status}`)
  const payloadRechazo = await esperaRechazo
  chk('el cliente RECIBE visita:rechazada', payloadRechazo !== null, 'timeout de 8s')
  const estadoRechazo = await http(`/api/visitas/estado/${solC.data.token}`, { token: token2 })
  chk('el estado queda RECHAZADA', estadoRechazo.data?.estado === 'RECHAZADA', `estado=${estadoRechazo.data?.estado}`)

  socket.disconnect()
  socket2.disconnect()

  console.log(`\n  TOTAL: ${ok} OK, ${fallas.length} FALLA`)
  if (fallas.length) {
    console.log('  FALLARON: ' + fallas.join(' | '))
    process.exit(1)
  }
  process.exit(0)
}

await main()
