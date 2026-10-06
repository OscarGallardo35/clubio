'use client'

/**
 * Estado del motor de upsell (en memoria, sin persist: es efimero por definicion).
 *
 * Lo que hay que saber:
 * - El set de sugerencias aceptadas vive solo en la sesion. No va a localStorage.
 * - El cache (hash -> sugerencias) tiene tope: `MAX_ENTRADAS_CACHE`.
 * - Toda la logica esta en `lib/upsell-maquina.ts` (puro).
 */
import { create } from 'zustand'
import { estadoUpsellInicial, reducerUpsell } from '../lib/upsell-maquina'
import type { EstadoUpsell, EventoUpsell } from '../lib/upsell-maquina'

export const useUpsellStore = create<EstadoUpsell & { despachar: (evento: EventoUpsell) => void }>()((set) => ({
  ...estadoUpsellInicial(),
  despachar: (evento) => set((s) => reducerUpsell(s, evento)),
}))
