'use client'

/**
 * Cache de la carta (en memoria, NO persistent).
 *
 * Decision explicita: no va a localStorage porque la carta tiene overrides por sucursal y
 * guardarla en disco arriesga servir precios de otra sucursal despues de un cambio. Se pierde
 * al recargar, que es barato: la carta son unos pocos KB y se vuelve a pedir.
 *
 * Toda la logica esta en `lib/carta-cache.ts` (puro). Este archivo solo la conecta con React.
 */
import { create } from 'zustand'
import { estadoCartaInicial, reducerCarta } from '../lib/carta-cache'
import type { EstadoCarta, EventoCarta } from '../lib/carta-cache'
import type { CartaPublica } from '../types/api'

interface AccionesCarta {
  despachar: (evento: EventoCarta) => void
}

export type CartaStore = EstadoCarta<CartaPublica> & AccionesCarta

export const useCartaStore = create<CartaStore>()((set) => ({
  ...estadoCartaInicial<CartaPublica>(),
  despachar: (evento) => set((s) => reducerCarta<CartaPublica>(s, evento)),
}))
