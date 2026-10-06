'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ESTADO_INICIAL, visitaReducir } from '@/lib/visita-maquina'
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

      despachar: (evento) =>
        set((s) => {
          const flujo = visitaReducir(s.flujo, evento)
          if (evento.tipo === 'SOLICITADA') {
            return { flujo, token: evento.token, expiraEn: evento.expiraEn, sucursalId: evento.sucursalId }
          }
          if (evento.tipo === 'RESET') {
            return { flujo, token: null, expiraEn: null, sucursalId: null, ws: 'desconectado' }
          }
          return { flujo }
        }),

      fijarWs: (ws) => set({ ws }),

      reiniciar: () => get().despachar({ tipo: 'RESET' }),

      /**
       * Tras rehidratar: si habia un token guardado, el flujo arranca en
       * 'esperando' para poder consultarle el estado real al backend (que es
       * quien sabe si sigue pendiente, si se aprobo o si vencio).
       */
      hidratar: () => {
        const { token, expiraEn, sucursalId, flujo } = get()
        if (!token || flujo.paso !== 'inicio') return
        set({
          flujo: visitaReducir(flujo, {
            tipo: 'SOLICITADA',
            token,
            expiraEn: expiraEn ?? new Date().toISOString(),
            sucursalId,
          }),
        })
      },
    }),
    {
      name: 'visita_sin-negocio',
      storage: createJSONStorage(() => localStorage),
      // Critico: en el servidor no hay localStorage y sin esto el primer render
      // del cliente no coincide con el HTML (warning de hydration mismatch).
      skipHydration: true,
      partialize: (s) => ({ token: s.token, expiraEn: s.expiraEn, sucursalId: s.sucursalId }),
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
