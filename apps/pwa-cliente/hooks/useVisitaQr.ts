'use client'

import * as React from 'react'
import { useBrandingCtx } from '@/components/BrandingProvider'
import { useClienteStore } from '@/stores/clienteStore'
import { configurarNegocioDeVisita, useVisitaStore } from '@/stores/visitaStore'
import { consultarEstado, crearSocketVisita, registrarCliente, sesionActual, solicitarVisita } from '@/lib/visita-service'
import { esFinal, eventoDeAprobacion, puedeReintentar, textoDelMotivo, tokenDeVisitaVivo } from '@/lib/visita-maquina'
import type { EstadoFlujo } from '@/lib/visita-maquina'
import { intervaloDeSondeo, sondeoVencido } from '@/lib/sondeo'
import type { EstadoWs } from '@/stores/visitaStore'
import { leerParametrosQr } from '@/lib/tenant'

/** El WS tiene 3 segundos para conectar; si no, se arranca a preguntar igual. */
const MS_ESPERA_WS = 3000

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
  /** Atajos para la UI: evitan que el consumidor conozca la forma de `flujo`. */
  mensajeWhatsApp: string | null
  urlValidacion: string | null
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
  /** true cuando el consult del resume (efecto 2) ya contesto (ok o no). */
  const [consultaLista, setConsultaLista] = React.useState(false)
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
      const s = useVisitaStore.getState()
      // Complemento del filtro del store: un token persistido que YA vencio (o que
      // no trae fecha) no se reanuda. Se suelta ANTES de hidratar para no arrancar
      // ni un tick en 'esperando' con un contador vencido: ese tick disparaba
      // EXPIRAR antes de que volviera el backend (el bug del primer intento).
      if (s.token && !tokenDeVisitaVivo(s.expiraEn)) s.reiniciar()
      else s.hidratar()
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
    setConsultaLista(false)
    let vivo = true
    void consultarEstado(token).then((r) => {
      if (!vivo) return
      setConsultaLista(true)
      if (!r) return
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

    /**
     * Origen de la ventana agresiva y del tope del respaldo: se cuenta desde que el flujo entro
     * en 'esperando' (o sea, desde que el cliente PIDIO la visita), no desde que arranca el
     * polling. Importa porque el polling suele empezar 3 s despues (la gracia del WS) y esos 3 s
     * son parte de la espera real del cliente.
     */
    const inicioEspera = Date.now()
    let socket: ReturnType<typeof crearSocketVisita> | null = null
    let temporizadorWs: ReturnType<typeof setTimeout> | null = null
    let temporizador: ReturnType<typeof setTimeout> | null = null
    let sondeando = false
    /** Evita apilar consultas si el backend tarda mas que el intervalo (latencia cruzada). */
    let enVuelo = false
    let cerrado = false

    /**
     * Respaldo por polling, con cadencia ADAPTATIVA (lib/sondeo.ts): cada 2,5 s durante los
     * primeros 30 s de espera y cada 5 s despues.
     *
     * Por que agresivo al principio: mientras el cliente mira la pantalla de espera, el respaldo
     * es TODO lo que tiene si el WS no esta vivo, y cada consulta tarda ~1,4 s por la latencia
     * cruzada entre regiones. Con el intervalo fijo de 5 s la demora percibida llegaba a +6,5 s;
     * con 2,5 s el peor caso baja a ~3,9 s. Despues de los 30 s (el cliente ya no esta esperando
     * activamente, aunque la pantalla siga abierta) vuelve a 5 s para no castigar al que la dejo
     * abierta media hora: son ~66 consultas en los 5 min de vida del token.
     */
    const arrancarPolling = () => {
      if (cerrado || sondeando) return
      sondeando = true
      fijarWs('polling')
      const tick = () => {
        if (cerrado) return
        const desdeElPedido = Date.now() - inicioEspera
        // Se agoto la vida del token (5 min): ya no puede aprobarse.
        if (sondeoVencido(desdeElPedido)) {
          despachar({ tipo: 'EXPIRAR' })
          return
        }
        const token = flujo.token
        if (token && !enVuelo) {
          enVuelo = true
          void consultarEstado(token)
            .then((r) => {
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
            .finally(() => {
              enVuelo = false
            })
        }
        temporizador = setTimeout(tick, intervaloDeSondeo(Date.now() - inicioEspera))
      }
      temporizador = setTimeout(tick, intervaloDeSondeo(Date.now() - inicioEspera))
    }

    const pararPolling = () => {
      sondeando = false
      if (temporizador) {
        clearTimeout(temporizador)
        temporizador = null
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
          // El pasamanos NO conoce la lista de campos: `eventoDeAprobacion` arma el evento desde el
          // payload tipado, asi que un campo nuevo del WS llega al reducer sin tocar este hook.
          despachar(eventoDeAprobacion(p))
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
  //    Con un token REANUDADO, mientras el consult del resume esta en vuelo NO se
  //    dispara: el timer local le ganaria por ~150ms a la respuesta del backend y
  //    el cliente veria "expiro" en el primer intento. Cuando el consult contesta,
  //    el contador se re-arma con la vida real del token (y el reducer, ademas,
  //    deja que esa respuesta corrija un vencimiento local).
  React.useEffect(() => {
    if (flujo.paso !== 'esperando' || !flujo.expiraEn) return
    if (flujo.reanudado && !consultaLista) return
    const faltan = new Date(flujo.expiraEn).getTime() - Date.now()
    const temporizador = setTimeout(() => despachar({ tipo: 'EXPIRAR' }), Math.max(0, faltan))
    return () => clearTimeout(temporizador)
  }, [flujo.paso, flujo.expiraEn, flujo.reanudado, consultaLista, despachar])

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
      despachar({
        tipo: 'SOLICITADA',
        token: r.token,
        expiraEn: r.expiraEn,
        sucursalId: r.sucursalId,
        // Vienen del backend y traen el Ref: token y el link de validacion.
        mensajeWhatsApp: r.mensajeWhatsApp,
        urlValidacion: r.urlValidacion,
      })
      return
    }
    if (r.requiereSesion) {
      // Un 401 no es un rechazo: se vuelve al formulario de registro (ABRIR_REGISTRO ya es la
      // transicion que muestra el registro, no se inventa otra).
      despachar({ tipo: 'ABRIR_REGISTRO' })
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
    mensajeWhatsApp: flujo.mensajeWhatsApp,
    urlValidacion: flujo.urlValidacion,
  }
}
