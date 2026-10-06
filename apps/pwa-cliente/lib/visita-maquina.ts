/**
 * Maquina de estados del flujo QR #2 (sumar una visita).
 *
 * Es una funcion PURA `(estado, evento) => estado`: sin React, sin fetch, sin
 * timers, sin localStorage. Todo lo que tiene efectos vive en useVisitaQr, que es
 * quien decide CUANDO llega cada evento. Asi el flujo entero se puede probar en
 * node sin browser (ver scripts/check-visita-maquina.ts).
 *
 * Reglas de diseño que sostienen el flujo:
 *  - NUNCA se reintenta solo: salir de `noSumada` o `error` requiere REINTENTAR o
 *    SOLICITAR, que son acciones explicitas del usuario.
 *  - Una aprobacion GANA siempre: si el staff aprueba justo cuando vencio el
 *    contador, el WS manda APROBADA y se muestra el exito igual.
 *  - EXPIRAR no puede pisar un exito ya mostrado.
 */

export type Paso =
  | 'inicio'
  | 'registrando'
  | 'solicitando'
  | 'esperando'
  | 'aprobada'
  | 'noSumada'
  | 'error'

/** Por que no se pudo sumar (el texto sale de textoDelMotivo). */
export type MotivoNoSumada = 'rechazada' | 'expirada' | 'yaSumadaHoy' | 'esperaHoras'

/** Lo que devuelve GET /visitas/estado/:token. */
export type EstadoVisitaToken = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'EXPIRADA'

export interface SellosTrasAprobar {
  sellosActuales: number
  premioDesbloqueado: boolean
}

export interface EstadoFlujo {
  paso: Paso
  /** Token de la solicitud (el que se guarda por negocio para reanudar). */
  token: string | null
  /** ISO: hasta cuando el staff puede aprobar. */
  expiraEn: string | null
  sucursalId: string | null
  /** Solo con paso = 'noSumada'. */
  motivo: MotivoNoSumada | null
  /** Horas que faltan cuando motivo = 'esperaHoras'. */
  faltanHoras: number | null
  /** Mensaje para paso = 'error' (y detalle del rechazo). */
  mensaje: string | null
  /** Sellos que trajo el WS: es la fuente de verdad, no se pide de nuevo. */
  sellos: SellosTrasAprobar | null
  /** true si el estado salio de un token guardado (no de una solicitud nueva). */
  reanudado: boolean
}

export type EventoFlujo =
  | { tipo: 'ABRIR_REGISTRO' }
  | { tipo: 'CERRAR_REGISTRO' }
  | { tipo: 'SOLICITAR' }
  | { tipo: 'SOLICITADA'; token: string; expiraEn: string; sucursalId: string | null }
  | { tipo: 'SOLICITUD_RECHAZADA'; motivo: 'esperaHoras' | 'yaSumadaHoy' | 'otro'; faltanHoras?: number; mensaje?: string }
  | { tipo: 'ESTADO_RECIBIDO'; estado: EstadoVisitaToken; motivo?: string; sellosActuales?: number; premioDesbloqueado?: boolean }
  | { tipo: 'WS_APROBADA'; sellosActuales: number; premioDesbloqueado: boolean }
  | { tipo: 'WS_RECHAZADA'; motivo?: string }
  | { tipo: 'EXPIRAR' }
  | { tipo: 'REINTENTAR' }
  | { tipo: 'ERROR_RED'; mensaje: string }
  | { tipo: 'RESET' }

export const ESTADO_INICIAL: EstadoFlujo = {
  paso: 'inicio',
  token: null,
  expiraEn: null,
  sucursalId: null,
  motivo: null,
  faltanHoras: null,
  mensaje: null,
  sellos: null,
  reanudado: false,
}

/** Paso en el que tiene sentido pedirle al usuario que reintente. */
export function puedeReintentar(estado: EstadoFlujo): boolean {
  return estado.paso === 'noSumada' || estado.paso === 'error'
}

/** Estados de los que ya no se sale solo (para cortar timers en la UI). */
export function esFinal(estado: EstadoFlujo): boolean {
  return estado.paso === 'aprobada' || estado.paso === 'noSumada' || estado.paso === 'error'
}

/** Texto que ve el cliente. Vive aca para poder testearlo. */
export function textoDelMotivo(estado: EstadoFlujo): string | null {
  switch (estado.motivo) {
    case 'rechazada':
      return 'El local no pudo validar tu visita. Hablá con el personal.'
    case 'expirada':
      return 'La solicitud expiró, ¿querés intentar de nuevo?'
    case 'yaSumadaHoy':
      return 'Ya sumaste hoy, mirá tu tarjeta.'
    case 'esperaHoras': {
      const h = estado.faltanHoras
      return h && h > 0
        ? `Todavía no podés sumar otra visita: esperá ${h} hora${h === 1 ? '' : 's'} más.`
        : 'Todavía no podés sumar otra visita.'
    }
    default:
      return null
  }
}

export function visitaReducir(estado: EstadoFlujo, evento: EventoFlujo): EstadoFlujo {
  switch (evento.tipo) {
    case 'RESET':
      return { ...ESTADO_INICIAL }

    case 'ABRIR_REGISTRO':
      return { ...estado, paso: 'registrando' }

    case 'CERRAR_REGISTRO':
      return { ...estado, paso: 'inicio' }

    // Se puede (re)pedir una visita desde el inicio, despues de registrarse,
    // despues de un intento fallido o de una visita ya sumada. NO desde
    // 'solicitando' ni 'esperando': ahi un POST de mas crearia ruido (el backend
    // reutiliza el token, pero la UI no tiene por que pedirlo).
    case 'SOLICITAR': {
      if (estado.paso === 'solicitando' || estado.paso === 'esperando') return estado
      return { ...estado, paso: 'solicitando', motivo: null, mensaje: null, faltanHoras: null }
    }

    case 'SOLICITADA':
      return {
        ...estado,
        paso: 'esperando',
        token: evento.token,
        expiraEn: evento.expiraEn,
        sucursalId: evento.sucursalId,
        motivo: null,
        mensaje: null,
        faltanHoras: null,
        reanudado: false,
      }

    // Un 400 del backend no es siempre un error: "espera 4 horas" y "ya sumaste
    // hoy" son estados con su propio texto, no un error rojo.
    case 'SOLICITUD_RECHAZADA': {
      if (evento.motivo === 'esperaHoras') {
        return {
          ...estado,
          paso: 'noSumada',
          motivo: 'esperaHoras',
          faltanHoras: evento.faltanHoras ?? null,
          mensaje: evento.mensaje ?? null,
        }
      }
      if (evento.motivo === 'yaSumadaHoy') {
        return { ...estado, paso: 'noSumada', motivo: 'yaSumadaHoy', faltanHoras: null, mensaje: null }
      }
      return { ...estado, paso: 'error', mensaje: evento.mensaje ?? 'No pudimos sumar tu visita.' }
    }

    // Respuesta de estado/:token (polling o al reanudar). Solo se aplica desde
    // los pasos donde tiene sentido: desde 'noSumada' se IGNORA, porque volver a
    // 'esperando' ahi seria reanudar automaticamente algo ya cerrado.
    case 'ESTADO_RECIBIDO': {
      if (estado.paso === 'noSumada' || estado.paso === 'error' || estado.paso === 'aprobada') return estado
      if (evento.estado === 'PENDIENTE') {
        return { ...estado, paso: 'esperando', reanudado: true, motivo: null, mensaje: null }
      }
      if (evento.estado === 'APROBADA') {
        return {
          ...estado,
          paso: 'aprobada',
          motivo: null,
          mensaje: null,
          sellos:
            typeof evento.sellosActuales === 'number'
              ? { sellosActuales: evento.sellosActuales, premioDesbloqueado: evento.premioDesbloqueado === true }
              : estado.sellos,
        }
      }
      if (evento.estado === 'RECHAZADA') {
        return { ...estado, paso: 'noSumada', motivo: 'rechazada', mensaje: evento.motivo ?? null }
      }
      return { ...estado, paso: 'noSumada', motivo: 'expirada', mensaje: null }
    }

    // La aprobacion GANA: vale desde cualquier paso (incluso si el contador ya
    // habia vencido y la pantalla mostraba "expiro").
    case 'WS_APROBADA':
      return {
        ...estado,
        paso: 'aprobada',
        motivo: null,
        mensaje: null,
        sellos: { sellosActuales: evento.sellosActuales, premioDesbloqueado: evento.premioDesbloqueado },
      }

    case 'WS_RECHAZADA':
      return { ...estado, paso: 'noSumada', motivo: 'rechazada', mensaje: evento.motivo ?? null }

    // El contador llego a cero. Nunca pisa un exito y no hace nada fuera de 'esperando'.
    case 'EXPIRAR':
      if (estado.paso !== 'esperando') return estado
      return { ...estado, paso: 'noSumada', motivo: 'expirada', mensaje: null }

    // Accion explicita del usuario. Es la UNICA puerta de salida de noSumada/error.
    case 'REINTENTAR': {
      if (!puedeReintentar(estado)) return estado
      return { ...estado, paso: 'solicitando', motivo: null, mensaje: null, faltanHoras: null }
    }

    case 'ERROR_RED':
      // Un fallo de red no borra una visita ya confirmada.
      if (estado.paso === 'aprobada') return estado
      return { ...estado, paso: 'error', mensaje: evento.mensaje }

    default:
      return estado
  }
}

export interface ClasificacionRechazo {
  motivo: 'esperaHoras' | 'yaSumadaHoy' | 'otro'
  faltanHoras: number | null
}

/**
 * Convierte el mensaje de un 400 de POST /visitas/solicitar en un motivo.
 *
 * El backend responde 400 con dos mensajes que NO son errores:
 *   "Todavia no podes sumar otra visita: espera N hora(s) mas"
 *   "Alcanzaste el limite de visitas por dia"
 * Todo lo demas si es un error. Los mensajes no llevan acentos, pero se normalizan
 * igual para no depender de eso.
 */
export function clasificarRechazoDeSolicitud(mensaje?: string | null): ClasificacionRechazo {
  const m = (mensaje ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (m.includes('limite de visitas por dia')) return { motivo: 'yaSumadaHoy', faltanHoras: null }

  const conHoras = /espera\s+(\d+)\s+hora/.exec(m)
  if (conHoras) return { motivo: 'esperaHoras', faltanHoras: Number(conHoras[1]) }
  if (m.includes('todavia no podes sumar otra visita')) return { motivo: 'esperaHoras', faltanHoras: null }

  return { motivo: 'otro', faltanHoras: null }
}

/** Tipos de evento existentes, para el test de totalidad. */
export const TIPOS_DE_EVENTO = [
  'ABRIR_REGISTRO', 'CERRAR_REGISTRO', 'SOLICITAR', 'SOLICITADA', 'SOLICITUD_RECHAZADA',
  'ESTADO_RECIBIDO', 'WS_APROBADA', 'WS_RECHAZADA', 'EXPIRAR', 'REINTENTAR', 'ERROR_RED', 'RESET',
] as const

export const PASOS: Paso[] = ['inicio', 'registrando', 'solicitando', 'esperando', 'aprobada', 'noSumada', 'error']
