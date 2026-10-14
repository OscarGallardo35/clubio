'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ESTADO_INICIAL, reanudarVisitaGuardada, visitaReducir } from '@/lib/visita-maquina'
import type { EstadoFlujo, EventoFlujo } from '@/lib/visita-maquina'

/** Como esta la conexion en vivo. El UI lo usa para explicar esperas largas. */
export type EstadoWs = 'desconectado' | 'conectando' | 'conectado' | 'reconectando' | 'polling'

interface VisitaState {
  flujo: EstadoFlujo
  ws: EstadoWs
  /** Se persisten SOLO estos tres: son los que permiten reanudar al reabrir. */
  token: string | null
  expiraEn: string | null
  sucursalId: string | null
  // Espejo persistible de lo que devuelve el backend (igual que token).
  mensajeWhatsApp: string | null
  urlValidacion: string | null
  despachar: (evento: EventoFlujo) => void
  fijarWs: (ws: EstadoWs) => void
  reiniciar: () => void
  hidratar: () => void
}

/**
 * El token se guarda por negocio: `visita_<negocioSlug>`. Un cliente puede tener
 * una visita viva en dos locales distintos sin que se pisen.
 *
 * La clave NO se puede fijar al crear el store (el slug se conoce recien cuando
 * el layout resolvio el tenant), asi que se cambia con setOptions antes de
 * rehidratar (ver configurarNegocioDeVisita).
 */
export const useVisitaStore = create<VisitaState>()(
  persist(
    (set, get) => ({
      flujo: { ...ESTADO_INICIAL },
      ws: 'desconectado',
      token: null,
      expiraEn: null,
      sucursalId: null,
      // Espejo de lo que guarda el flujo, para poder persistirlo.
      mensajeWhatsApp: null,
      urlValidacion: null,
      despachar: (evento) =>
        set((s) => {
          const flujo = visitaReducir(s.flujo, evento)
          if (evento.tipo === 'SOLICITADA') {
            return {
                  flujo,
                  token: evento.token,
                  expiraEn: evento.expiraEn,
                  sucursalId: evento.sucursalId,
                  mensajeWhatsApp: evento.mensajeWhatsApp ?? null,
                  urlValidacion: evento.urlValidacion ?? null,
                }
          }
          if (evento.tipo === 'RESET') {
            return {
              flujo,
              token: null,
              expiraEn: null,
              sucursalId: null,
              mensajeWhatsApp: null,
              urlValidacion: null,
              ws: 'desconectado',
            }
          }
          // Sintoma hermano: al llegar a 'aprobada' se suelta el token persistido.
          // `partialize` no persiste `paso`, asi que en la proxima carga el token
          // usado se re-sembraria como 'esperando' y el resume volveria a caer en
          // 'aprobada': el cliente veria la confirmacion de la visita ANTERIOR sin
          // forma de arrancar una nueva en ese dispositivo. Soltandolo, cada carga
          // arranca en el paso inicial.
          if (flujo.paso === 'aprobada') {
            return {
              flujo,
              token: null,
              expiraEn: null,
              sucursalId: null,
              mensajeWhatsApp: null,
              urlValidacion: null,
            }
          }
          return { flujo }
        }),

      fijarWs: (ws) => set({ ws }),

      reiniciar: () => get().despachar({ tipo: 'RESET' }),

      /**
       * Tras rehidratar: si habia un token guardado Y SIGUE VIVO, el flujo arranca
       * en 'esperando' para consultarle el estado real al backend (que es quien
       * sabe si sigue pendiente, si se aprobo o si vencio).
       *
       * Si el token ya vencio (o no tiene fecha), NO se reanuda: se descarta y el
       * cliente arranca en el paso inicial. Reanudarlo haria que el timer local de
       * vencimiento dispare EXPIRAR antes de que vuelva la respuesta del backend y
       * el cliente veria "no se sumo / la solicitud expiro" en el PRIMER intento.
       */
      hidratar: () => {
        const { token, expiraEn, sucursalId, mensajeWhatsApp, urlValidacion, flujo } = get()
        if (!token || flujo.paso !== 'inicio') return
        const reanudado = reanudarVisitaGuardada(flujo, {
          token,
          expiraEn,
          sucursalId,
          mensajeWhatsApp,
          urlValidacion,
        })
        if (reanudado.paso !== 'inicio') {
          set({ flujo: reanudado })
          return
        }
        set({
          token: null,
          expiraEn: null,
          sucursalId: null,
          mensajeWhatsApp: null,
          urlValidacion: null,
        })
      },
    }),
    {
      name: 'visita_sin-negocio',
      storage: createJSONStorage(() => localStorage),
      // Critico: en el servidor no hay localStorage y sin esto el primer render
      // del cliente no coincide con el HTML (warning de hydration mismatch).
      skipHydration: true,
      partialize: (s) => ({
          token: s.token,
          expiraEn: s.expiraEn,
          sucursalId: s.sucursalId,
          mensajeWhatsApp: s.mensajeWhatsApp,
          urlValidacion: s.urlValidacion,
        }),
    },
  ),
)

/** Cambia la clave de persistencia al negocio actual. Idempotente. */
export function configurarNegocioDeVisita(negocioSlug: string): void {
  const nombre = `visita_${negocioSlug}`
  if (useVisitaStore.persist.getOptions().name !== nombre) {
    useVisitaStore.persist.setOptions({ name: nombre })
  }
}
