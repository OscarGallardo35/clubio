import { ApiError, createSocket, endpoints } from '@repo/api-client'
import type { Socket } from 'socket.io-client'
import type { ClienteMe, EstadoVisitaRespuesta, SolicitarVisitaRespuesta } from '@/types/api'
import { api, clienteApi, WS_URL } from './api'
import type { ClasificacionRechazo, EstadoVisitaToken } from './visita-maquina'
import { clasificarRechazoDeSolicitud } from './visita-maquina'

/**
 * Transporte del flujo QR #2: todo lo que habla con el backend, aislado del
 * reducer y de React. La logica pura (clasificar un 400, transiciones) vive en
 * visita-maquina.ts, que no importa nada y por eso se puede testear en node.
 */

export interface SolicitudOk {
  /** Discriminante explicito: sin esto TS no puede estrechar la union. */
  ok: true
  token: string
  expiraEn: string
  sucursalId: string | null
  reutilizado: boolean
  /** Vienen del backend: traen el token y el link de validacion. Antes se descartaban. */
  mensajeWhatsApp: string | null
  urlValidacion: string | null
}

export interface SolicitudFallida {
  /** true si el backend contesto 401: falta sesion, y se resuelve volviendo al registro. */
  requiereSesion: boolean
  ok: false
  rechazo: ClasificacionRechazo
  mensaje: string
  status: number
  /** En una solicitud fallida no hay mensaje para WhatsApp. */
  mensajeWhatsApp: null
  urlValidacion: null
}

/** POST /visitas/solicitar. Nunca lanza por un 400 del negocio: lo clasifica. */
export async function solicitarVisita(
  sucursalSlug: string | null,
  origen?: string | null,
): Promise<SolicitudOk | SolicitudFallida> {
  try {
    const r = await api.post<SolicitarVisitaRespuesta>(endpoints.visitas.solicitar, {
      // Se mandan los dos: el backend resuelve por slug y cae a la principal.
      ...(sucursalSlug ? { sucursalSlug } : {}),
      ...(origen ? { origen } : {}),
    })
    return {
      ok: true,
      token: r.token,
      expiraEn: r.expiraEn,
      sucursalId: r.sucursal?.id ?? null,
      reutilizado: r.reutilizado === true,
        // El mensaje ya trae nombre, negocio, Ref: token y el link de validacion.
        mensajeWhatsApp: r.mensajeWhatsApp ?? null,
        urlValidacion: r.urlValidacion ?? null,
    }
  } catch (e) {
    if (e instanceof ApiError) {
      const mensaje = typeof e.data?.message === 'string' ? e.data.message : e.message
      // 401 = FALTA SESION, no un rechazo del negocio. El api-client lo tira como
      // `ApiError(401, undefined, 'No autorizado')`, asi que sin este caso aparte el flow lo
      // clasificaba como rechazo 'otro' y terminaba en la pantalla de error con un texto que el
      // cliente no puede resolver (y un "Reintentar" que volvia a pegarle sin sesion).
      const requiereSesion = e.status === 401
      return {
        ok: false,
        requiereSesion,
        rechazo: requiereSesion
          ? { motivo: 'otro' as const, faltanHoras: null }
          : clasificarRechazoDeSolicitud(mensaje),
        mensaje, status: e.status, mensajeWhatsApp: null, urlValidacion: null,
      }
    }
    return {
      ok: false,
      requiereSesion: false,
      rechazo: { motivo: 'otro', faltanHoras: null },
      mensaje: e instanceof Error ? e.message : 'No pudimos conectar con el local',
      status: 0,
        mensajeWhatsApp: null,
        urlValidacion: null,
    }
  }
}

export interface RegistroOk {
  ok: true
  accessToken: string
  nombre: string
  telefono: string
}

export interface RegistroFallido {
  ok: false
  mensaje: string
}

/**
 * POST /auth/cliente/registrar. Devuelve el accessToken del body: la cookie que
 * setea es HttpOnly y el WebSocket NO la puede leer, asi que el token hace falta
 * para el handshake.
 */
export async function registrarCliente(datos: {
  nombre: string
  telefono: string
  negocioSlug: string
  sucursalSlug?: string | null
}): Promise<RegistroOk | RegistroFallido> {
  try {
    const r = await clienteApi.registrar({
      nombre: datos.nombre,
      telefono: datos.telefono,
      negocioSlug: datos.negocioSlug,
      ...(datos.sucursalSlug ? { sucursalSlug: datos.sucursalSlug } : {}),
    })
    return { ok: true, accessToken: r.accessToken, nombre: r.cliente.nombre, telefono: r.cliente.telefono }
  } catch (e) {
    if (e instanceof ApiError) {
      const mensaje = typeof e.data?.message === 'string' ? e.data.message : e.message
      return { ok: false, mensaje }
    }
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No pudimos registrarte' }
  }
}

export interface EstadoConsultado {
  estado: EstadoVisitaToken
  motivo: string | null
  sellosActuales: number | null
  premioDesbloqueado: boolean
}

/** GET /visitas/estado/:token. Devuelve null si la red fallo (el caller decide). */
export async function consultarEstado(token: string): Promise<EstadoConsultado | null> {
  try {
    const r = await api.get<EstadoVisitaRespuesta>(endpoints.visitas.estado(token))
    return {
      estado: r.estado,
      motivo: r.motivo ?? null,
      sellosActuales: typeof r.sellosActuales === 'number' ? r.sellosActuales : null,
      premioDesbloqueado: r.premioDesbloqueado === true,
    }
  } catch {
    return null
  }
}

export interface ManejadoresWs {
  onConectado?: () => void
  onReconectando?: () => void
  onDesconectado?: (motivo: string) => void
  onAprobada?: (p: { sellosActuales: number; premioDesbloqueado: boolean }) => void
  onRechazada?: (p: { motivo: string }) => void
}

/**
 * Socket del namespace /visitas con los manejadores del flujo.
 * El token va en `auth.token` (es lo que lee el gateway); si no hay token, el
 * handshake se autentica igual con la cookie HttpOnly (withCredentials).
 */
export function crearSocketVisita(manejadores: ManejadoresWs, token?: string | null, namespace = '/visitas') {
  const socket: Socket = createSocket({ url: WS_URL, namespace, token: token ?? null })

  // Los manejadores se enganchan aca y no en el config: createSocket tipa
  // onDisconnect como `() => void` y el flujo necesita el motivo.
  if (manejadores.onConectado) socket.on('connect', manejadores.onConectado)
  if (manejadores.onDesconectado) {
    socket.on('disconnect', (motivo: string) => manejadores.onDesconectado?.(motivo))
  }

  // El gateway reemite con el nombre de la sala; el payload es la fuente de verdad.
  socket.on('visita:aprobada', (p: { sellosActuales?: number; premioDesbloqueado?: boolean }) => {
    manejadores.onAprobada?.({
      sellosActuales: typeof p?.sellosActuales === 'number' ? p.sellosActuales : 0,
      premioDesbloqueado: p?.premioDesbloqueado === true,
    })
  })
  socket.on('visita:rechazada', (p: { motivo?: string }) => {
    manejadores.onRechazada?.({ motivo: p?.motivo ?? 'Rechazada por el local' })
  })
  socket.io.on('reconnect_attempt', () => manejadores.onReconectando?.())

  return socket
}

/** GET /auth/cliente/me. Devuelve null si no hay sesion (401) o si fallo la red. */
export async function sesionActual(): Promise<ClienteMe | null> {
  try {
    return await clienteApi.me()
  } catch {
    return null
  }
}
