'use client'

/**
 * Carrito de la PWA Cliente: zustand + persist.
 *
 * Toda la logica vive en `lib/carrito-maquina.ts` (reducer puro y testeable en node).
 * Este archivo solo la conecta con React y con localStorage.
 *
 * Detalles que importan:
 * - `skipHydration: true`: sin esto zustand toca localStorage durante el render del server
 *   y saltan los warnings de hydration mismatch (misma convencion que visitaStore).
 * - La clave es `carrito_<negocioSlug>`: un cliente puede tener carritos abiertos en dos
 *   negocios distintos sin que se pisen. Se cambia con `persist.setOptions` en `activar`.
 * - `partialize`: se guarda el carrito, no el estado de la UI (error/upsell son de la
 *   sesion). Con el `pedido` guardado, reabrir la app puede seguir el pedido por linkToken.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  estadoInicial,
  recortarParaPersistir,
  reducerCarrito,
  rehidratar,
} from '../lib/carrito-maquina'
import type {
  EstadoCarrito,
  EventoCarrito,
  ItemCarta,
} from '../lib/carrito-maquina'

interface AccionesCarrito {
  /** Unico punto de entrada: todo el flujo pasa por el reducer. */
  despachar: (evento: EventoCarrito) => void
  /**
   * Fija el negocio activo: cambia la clave de persistencia, rehidrata y cruza lo guardado
   * con la sucursal viva (si es otra sucursal, vacia con aviso). Idempotente.
   */
  activar: (
    negocioSlug: string,
    sucursalId: string | null,
    sucursalSlug: string | null,
    carta?: ItemCarta[] | undefined,
  ) => Promise<void>
  limpiar: () => void
}

export type CarritoStore = EstadoCarrito & AccionesCarrito

const claveDe = (slug: string): string => `carrito_${slug || 'sin-negocio'}`

export const useCarritoStore = create<CarritoStore>()(
  persist(
    (set) => ({
      ...estadoInicial('sin-negocio', null, null),

      despachar: (evento) => set((s) => reducerCarrito(s, evento)),

      activar: async (negocioSlug, sucursalId, sucursalSlug, carta) => {
        if (useCarritoStore.persist.getOptions().name !== claveDe(negocioSlug)) {
          useCarritoStore.persist.setOptions({ name: claveDe(negocioSlug) })
          await useCarritoStore.persist.rehydrate()
        }
        set((s) =>
          rehidratar(recortarParaPersistir({ ...s, negocioSlug }), {
            sucursalId,
            sucursalSlug,
            ...(carta ? { carta } : {}),
          }),
        )
      },

      limpiar: () => set((s) => reducerCarrito(s, { tipo: 'LIMPIAR' })),
    }),
    {
      name: claveDe('sin-negocio'),
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => recortarParaPersistir(s) as unknown as CarritoStore,
    },
  ),
)

/** Selector del total, para no re-renderizar por cualquier cambio. */
export const seleccionarTotal = (s: CarritoStore): number =>
  s.items.reduce(
    (acc, i) =>
      acc +
      (i.precioBase + i.modificadores.reduce((a, m) => a + m.opciones.reduce((x, o) => x + o.precioExtra, 0), 0)) *
        i.cantidad,
    0,
  )
