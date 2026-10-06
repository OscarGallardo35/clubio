'use client'

import * as React from 'react'
import { useBrandingCtx } from '@/components/BrandingProvider'
import { useClienteStore } from '@/stores/clienteStore'
import { configurarNegocioDeVisita, useVisitaStore } from '@/stores/visitaStore'
import { consultarEstado, crearSocketVisita, registrarCliente, sesionActual, solicitarVisita } from '@/lib/visita-service'
import { esFinal, puedeReintentar, textoDelMotivo } from '@/lib/visita-maquina'
import type { EstadoFlujo } from '@/lib/visita-maquina'
import type { EstadoWs } from '@/stores/visitaStore'
import { leerParametrosQr } from '@/lib/tenant'

/** El WS tiene 3 segundos para conectar; si no, se arranca a preguntar igual. */
const MS_ESPERA_WS = 3000
/** Intervalo y tope del respaldo por polling: 60 x 5s = 5 min (la vida del token). */
const MS_POLLING = 5000
const MAX_POLLING = 60

export interface UseVisitaQr {
  flujo: EstadoFlujo
  ws: EstadoWs
  /** Registra al cliente y arranca la solicitud en un solo paso. */
  registrar: (datos: { nombre: string; telefono: string }) => Promise<void>
  /** Texto del motivo cuando el paso es 'noSumada'. */
  textoMotivo: string | null
  puedeReintentar: boolean
  esFinal: boolean
  solicitar: () => Promise<void>
  reintentar: () => Promise<void>
  reiniciar: () => void
}

/**
 * Orquestador del flujo QR #2.
 *
 * No decide transiciones (eso es del reducer): solo traduce el mundo real
 * (fetch, WebSocket, timers, cambios de pestaña) a eventos, en el orden que
 * corresponde. Toda la logica testeable esta en visita-maquina.ts.
 */
export function useVisitaQr(sucursalSlug: string | null = null): UseVisitaQr {
  // Del contexto y no del store: el contexto ya tiene el negocio que resolvio
  // el servidor (el store se llena en un efecto, despues).
  const negocioSlug = useBrandingCtx().negocio?.slug ?? null
  const tokenAcceso = useClienteStore((s) => s.token)
  const actualizarSellos = useClienteStore((s) => s.actualizarSellos)
  const fijarSesion = useClienteStore((s) => s.fijarSesion)

  const flujo = useVisitaStore((s) => s.flujo)
  const ws = useVisitaStore((s) => s.ws)
  const despachar = useVisitaStore((s) => s.despachar)
  const fijarWs = useVisitaStore((s) => s.fijarWs)
  const reiniciar = useVisitaStore((s) => s.reiniciar)

  const [listo, setListo] = React.useState(false)
  /** Evita reconsultar el mismo token en cada render. */
  const consultados = React.useRef<string | null>(null)
  /** Evita aplicar dos veces los sellos de la misma aprobacion. */
  const sellosAplicados = React.useRef<string | null>(null)

  // 1) Clave por negocio + rehidratacion (skipHydration) + resume si habia token.
  React.useEffect(() => {
    if (!negocioSlug) return
    let vivo = true
    configurarNegocioDeVisita(negocioSlug)
    void Promise.resolve(useVisitaStore.persist.rehydrate()).finally(() => {
      if (!vivo) return
      useVisitaStore.getState().hidratar()
      setListo(true)
    })
    return () => {
      vivo = false
    }
  }, [negocioSlug])

  // 2) Con una solicitud viva, preguntarle al backend en que quedo (reanudar).
  React.useEffect(() => {
    const token = flujo.token
    if (!listo || flujo.paso !== 'esperando' || !token || consultados.current === token) return
    consultados.current = token
    let vivo = true
    void consultarEstado(token).then((r) => {
      if (!vivo || !r) return
      despachar({
        tipo: 'ESTADO_RECIBIDO',
        estado: r.estado,
        ...(r.motivo ? { motivo: r.motivo } : {}),
        ...(typeof r.sellosActuales === 'number' ? { sellosActuales: r.sellosActuales } : {}),
        premioDesbloqueado: r.premioDesbloqueado,
      })
    })
    return () => {
      vivo = false
    }
  }, [listo, flujo.paso, flujo.token, despachar])

  // 3) WebSocket mientras se espera, con el respaldo por polling.
  React.useEffect(() => {
    if (flujo.paso !== 'esperando' || !flujo.token) return

    let socket: ReturnType<typeof crearSocketVisita> | null = null
    let temporizadorWs: ReturnType<typeof setTimeout> | null = null
    let intervalo: ReturnType<typeof setInterval> | null = null
    let intentos = 0
    let cerrado = false

    const arrancarPolling = () => {
      if (cerrado || intervalo) return
      fijarWs('polling')
      intervalo = setInterval(() => {
        intentos += 1
        // Se agotaron los 5 minutos: el token ya no puede aprobarse.
        if (intentos > MAX_POLLING) {
          despachar({ tipo: 'EXPIRAR' })
          return
        }
        const token = flujo.token
        if (!token) return
        void consultarEstado(token).then((r) => {
          if (cerrado || !r) return
          // Solo se despacha algo definitivo: PENDIENTE se ignora (ya estamos esperando).
          if (r.estado !== 'PENDIENTE') {
            despachar({
              tipo: 'ESTADO_RECIBIDO',
              estado: r.estado,
              ...(r.motivo ? { motivo: r.motivo } : {}),
              ...(typeof r.sellosActuales === 'number' ? { sellosActuales: r.sellosActuales } : {}),
              premioDesbloqueado: r.premioDesbloqueado,
            })
          }
        })
      }, MS_POLLING)
    }

    const pararPolling = () => {
      if (intervalo) {
        clearInterval(intervalo)
        intervalo = null
      }
    }

    fijarWs('conectando')
    socket = crearSocketVisita(
      {
        onConectado: () => {
          if (cerrado) return
          // El WS andando: no hace falta insistir con polling.
          if (temporizadorWs) {
            clearTimeout(temporizadorWs)
            temporizadorWs = null
          }
          pararPolling()
          fijarWs('conectado')
        },
        onReconectando: () => {
          if (!cerrado) {
            fijarWs('reconectando')
            arrancarPolling()
          }
        },
        onDesconectado: () => {
          if (cerrado) return
          fijarWs('desconectado')
          arrancarPolling()
        },
        onAprobada: (p) => {
          if (cerrado) return
          despachar({ tipo: 'WS_APROBADA', sellosActuales: p.sellosActuales, premioDesbloqueado: p.premioDesbloqueado })
        },
        onRechazada: (p) => {
          if (cerrado) return
          despachar({ tipo: 'WS_RECHAZADA', motivo: p.motivo })
        },
      },
      tokenAcceso,
    )

    // Regla: si en 3s no conecto, se arranca el polling SIN esperar a que se rinda.
    temporizadorWs = setTimeout(() => {
      if (!cerrado && useVisitaStore.getState().ws !== 'conectado') arrancarPolling()
    }, MS_ESPERA_WS)

    return () => {
      cerrado = true
      if (temporizadorWs) clearTimeout(temporizadorWs)
      pararPolling()
      socket?.disconnect()
      fijarWs('desconectado')
    }
  }, [flujo.paso, flujo.token, tokenAcceso, despachar, fijarWs])

  // 4) Vencimiento del token: el contador manda (y nunca pisa una aprobacion).
  React.useEffect(() => {
    if (flujo.paso !== 'esperando' || !flujo.expiraEn) return
    const faltan = new Date(flujo.expiraEn).getTime() - Date.now()
    const temporizador = setTimeout(() => despachar({ tipo: 'EXPIRAR' }), Math.max(0, faltan))
    return () => clearTimeout(temporizador)
  }, [flujo.paso, flujo.expiraEn, despachar])

  // 5) Sincronizar los sellos: el payload del WS es la fuente de verdad, sin fetch.
  React.useEffect(() => {
    if (flujo.paso !== 'aprobada' || !flujo.sellos) return
    const clave = `${flujo.token ?? ''}:${flujo.sellos.sellosActuales}`
    if (sellosAplicados.current === clave) return
    sellosAplicados.current = clave
    actualizarSellos(flujo.sucursalId ?? '', flujo.sellos.sellosActuales, flujo.sellos.premioDesbloqueado)
  }, [flujo.paso, flujo.sellos, flujo.sucursalId, flujo.token, actualizarSellos])

  const solicitar = React.useCallback(async () => {
    despachar({ tipo: 'SOLICITAR' })
    const origen = leerParametrosQr(typeof window === 'undefined' ? '' : window.location.search).origen
    const r = await solicitarVisita(sucursalSlug, origen)
    if (r.ok) {
      despachar({ tipo: 'SOLICITADA', token: r.token, expiraEn: r.expiraEn, sucursalId: r.sucursalId })
      return
    }
    despachar({
      tipo: 'SOLICITUD_RECHAZADA',
      motivo: r.rechazo.motivo,
      ...(r.rechazo.faltanHoras !== null ? { faltanHoras: r.rechazo.faltanHoras } : {}),
      mensaje: r.mensaje,
    })
  }, [despachar, sucursalSlug])

  const reintentar = React.useCallback(async () => {
    despachar({ tipo: 'REINTENTAR' })
    await solicitar()
  }, [despachar, solicitar])

  /**
   * Registro + sesion + primera solicitud. El token que devuelve el backend se
   * guarda en el store del cliente porque el WebSocket lo necesita (la cookie
   * es HttpOnly y JS no la ve).
   */
  const registrar = React.useCallback(
    async (datos: { nombre: string; telefono: string }) => {
      if (!negocioSlug) return
      const r = await registrarCliente({
        nombre: datos.nombre,
        telefono: datos.telefono,
        negocioSlug,
        sucursalSlug,
      })
      if (!r.ok) {
        despachar({ tipo: 'ERROR_RED', mensaje: r.mensaje })
        return
      }
      const me = await sesionActual()
      if (me) {
        fijarSesion({ cliente: me.cliente, tarjetas: me.tarjetas, sumoHoy: me.sumoHoy, token: r.accessToken })
      }
      await solicitar()
    },
    [negocioSlug, sucursalSlug, despachar, fijarSesion, solicitar],
  )

  return {
    flujo,
    ws,
    registrar,
    textoMotivo: textoDelMotivo(flujo),
    puedeReintentar: puedeReintentar(flujo),
    esFinal: esFinal(flujo),
    solicitar,
    reintentar,
    reiniciar,
  }
}
