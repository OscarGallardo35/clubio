'use client'

/**
 * Modificadores de un item (zustand en memoria, sin persist: son datos de la carta, se
 * refetchean solos). Toda la logica esta en `lib/modificadores-cache.ts` (puro y testeado).
 */
import { create } from 'zustand'
import { estadoModificadoresInicial, reducerModificadores } from '../lib/modificadores-cache'
import type { EstadoModificadores, EventoModificadores } from '../lib/modificadores-cache'

export const useModificadoresStore = create<EstadoModificadores & { despachar: (evento: EventoModificadores) => void }>()(
  (set) => ({
    ...estadoModificadoresInicial(),
    despachar: (evento) => set((s) => reducerModificadores(s, evento)),
  }),
)
