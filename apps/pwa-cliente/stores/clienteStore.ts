'use client'

import { create } from 'zustand'
import type { ClienteBasico, TarjetaSucursal } from '@/types/api'

interface ClienteState {
  cliente: ClienteBasico | null
  tarjetas: TarjetaSucursal[]
  sumoHoy: boolean
  /** true si la ultima aprobacion desbloqueo un premio (lo trae el WS). */
  premioPendiente: boolean
  /** Token en MEMORIA: lo necesita el handshake del WebSocket (la cookie es HttpOnly
   *  y JS no la puede leer). Tras un reload se pierde y el WS se autentica con la
   *  cookie igual, asi que no se persiste a proposito. */
  token: string | null
  cargando: boolean
  autenticado: boolean
  fijarSesion: (datos: {
    cliente: ClienteBasico
    tarjetas: TarjetaSucursal[]
    sumoHoy: boolean
    token?: string | null
  }) => void
  actualizarSellos: (sucursalId: string, sellos: number, premioDesbloqueado?: boolean) => void
  limpiar: () => void
}

export const useClienteStore = create<ClienteState>()((set, get) => ({
  cliente: null,
  tarjetas: [],
  sumoHoy: false,
  premioPendiente: false,
  token: null,
  cargando: false,
  autenticado: false,

  fijarSesion: ({ cliente, tarjetas, sumoHoy, token }) =>
    set({
      cliente,
      tarjetas,
      sumoHoy,
      autenticado: true,
      cargando: false,
      token: token ?? get().token,
    }),

  /**
   * Optimista: el WS ya trae los sellos nuevos al aprobar, asi que la tarjeta se
   * actualiza sin esperar otro GET.
   */
  actualizarSellos: (sucursalId, sellos, premioDesbloqueado) =>
    set((s) => ({
      sumoHoy: true,
      // El premio queda pendiente de canje hasta que el cliente lo muestre en el local.
      premioPendiente: premioDesbloqueado === true ? true : s.premioPendiente,
      tarjetas: s.tarjetas.map((t) => (t.sucursalId === sucursalId ? { ...t, sellosActuales: sellos } : t)),
    })),

  limpiar: () =>
    set({
      cliente: null, tarjetas: [], sumoHoy: false, premioPendiente: false,
      token: null, autenticado: false, cargando: false,
    }),
}))
