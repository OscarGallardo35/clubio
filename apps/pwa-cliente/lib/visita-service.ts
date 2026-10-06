import { ApiError, createSocket, endpoints } from '@repo/api-client'
import type { Socket } from 'socket.io-client'
import type { EstadoVisitaRespuesta, SolicitarVisitaRespuesta } from '@/types/api'
import { api, WS_URL } from './api'
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
}

export interface SolicitudFallida {
  ok: false
  rechazo: ClasificacionRechazo
  mensaje: string
  status: number
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
    }
  } catch (e) {
    if (e instanceof ApiError) {
      const mensaje = typeof e.data?.message === 'string' ? e.data.message : e.message
      return { ok: false, rechazo: clasificarRechazoDeSolicitud(mensaje), mensaje, status: e.status }
    }
    return {
      ok: false,
      rechazo: { motivo: 'otro', faltanHoras: null },
      mensaje: e instanceof Error ? e.message : 'No pudimos conectar con el local',
      status: 0,
    }
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
