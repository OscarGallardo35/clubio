'use client'

/**
 * Orquestador del upsell: mira el carrito, espera 500 ms de calma y recien ahi consulta.
 *
 * El debounce es real (un setTimeout que se reprograma en cada cambio y se cancela en el
 * cleanup). Toda la decision de "hay que pedir o no" la toma `decidirConsulta`, que es pura:
 * aca no se decide nada, solo se ejecuta el plan.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { upsellApi } from '../lib/api'
import { DEBOUNCE_UPSELL_MS, decidirConsulta, hashCarrito, sugerenciasVisibles } from '../lib/upsell-maquina'
import { useUpsellStore } from '../stores/upsellStore'
import type { ItemCarrito, SugerenciaUpsell } from '../lib/carrito-maquina'

export interface UsoUpsell {
  sugerencias: SugerenciaUpsell[]
  /** El negocio no tiene upsell: no se muestra nada y no se vuelve a pedir. */
  desactivado: boolean
  cargando: boolean
  /** El usuario agrego la sugerencia: no se vuelve a ofrecer en la sesion. */
  aceptar: (reglaId: string, itemId?: string) => void
  /** Se llama al cambiar de sucursal: los precios de la sugerencia cambian. */
  alCambiarSucursal: () => void
}

export function useUpsell(items: ItemCarrito[]): UsoUpsell {
  const despachar = useUpsellStore((s) => s.despachar)
  const desactivado = useUpsellStore((s) => s.desactivado)

  // 1) Avisar del carrito. El reducer ignora el evento si el hash no cambio, asi que una
  //    identidad nueva del array no dispara nada.
  // El hash entra como dependencia en lugar del array: `items` es una referencia nueva en cada
  // render, asi que el efecto corria siempre. Con el hash, solo cuando el carrito cambia de verdad
  // (y el reducer ademas ignora el evento si el hash es el mismo).
  const hashDelCarrito = useMemo(() => hashCarrito(items), [items])
  useEffect(() => {
    despachar({ tipo: 'CARRITO_CAMBIO', items, ahora: Date.now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [despachar, hashDelCarrito])

  // Los items se leen por ref: `pedir` no puede depender de su identidad (cambiaba en cada
  // render y volvia a crear el callback, que es lo que re-disparaba el efecto).
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const pedir = useCallback(
    async (hash: string) => {
      try {
        const r = await upsellApi.calcular({
          items: itemsRef.current.map((i) => ({ itemId: i.itemId, cantidad: i.cantidad })),
        })
        despachar({ tipo: 'RESPUESTA', hash, sugerencias: (r?.sugerencias ?? []) as SugerenciaUpsell[], motivo: r?.motivo ?? null, ahora: Date.now() })
      } catch {
        despachar({ tipo: 'ERROR' })
      }
    },
    [despachar],
  )

  // 2) Ejecutar el plan. Si falta el debounce, se reprograma; el cleanup lo cancela.
  const estado = useUpsellStore()
  useEffect(() => {
    if (!estado.hashPendiente) return undefined
    const plan = decidirConsulta(estado, Date.now())
    if (plan.accion === 'pedir') {
      void pedir(plan.hash)
      return undefined
    }
    if (plan.accion === 'nada' && plan.motivo === 'esperando') {
      const espera = Math.max(0, DEBOUNCE_UPSELL_MS - (Date.now() - (estado.hashDesde ?? 0)))
      const t = setTimeout(() => void pedir(estado.hashPendiente as string), espera)
      return () => clearTimeout(t)
    }
    return undefined
  }, [estado, pedir])

  const sugerencias = useMemo(() => sugerenciasVisibles(estado), [estado])
  return {
    sugerencias,
    desactivado,
    cargando: estado.cargando,
    aceptar: useCallback((reglaId: string) => despachar({ tipo: 'ACEPTAR', reglaId }), [despachar]),
    alCambiarSucursal: useCallback(() => despachar({ tipo: 'CAMBIAR_SUCURSAL' }), [despachar]),
  }
}
