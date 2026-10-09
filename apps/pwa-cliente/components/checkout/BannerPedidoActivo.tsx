'use client'

/**
 * Banner discreto para volver al pedido en curso. Se muestra en menu/club cuando el store tiene el
 * linkToken del ultimo pedido (lo deja PEDIDO_OK) Y ese link todavia sirve, asi el que cierra la PWA
 * puede volver sin acordarse de nada.
 */
import * as React from 'react'
import Link from 'next/link'
import { useCarritoStore } from '@/stores/carritoStore'
import { pedidoVigente } from '@/lib/carrito-maquina'
import { pedidosApi } from '@/lib/api'
import { clasificarFalloPedido, debeOlvidarPedido, esFinal, normalizarError } from '@/lib/checkout-maquina'

export function BannerPedidoActivo({ slugNegocio }: { slugNegocio: string }) {
  const pedido = useCarritoStore((s) => s.pedido)
  const despachar = useCarritoStore((s) => s.despachar)
  const linkToken = pedido?.linkToken ?? null

  // DOS guardas contra el loop "banner -> 410 -> volver -> banner":
  // 1. Solo se ofrece si el link sigue VIGENTE (`expiraEn` que guarda PEDIDO_OK).
  // 2. Si ya vencio, se limpia solo al montar: no vuelve ni recargando.
  // El caso que se escape (un link que el backend invalida antes de hora) lo cierra el propio
  // seguimiento: el 410 suelta el pedido (ver `debeOlvidarPedido`).
  const vigente = pedidoVigente(pedido)
  React.useEffect(() => {
    if (linkToken && !vigente) despachar({ tipo: 'OLVIDAR_PEDIDO' })
  }, [linkToken, vigente, despachar])

  /**
   * Tercera guarda: el pedido guardado puede no tener estado SINCRONIZADO. Dos casos reales:
   * una pestana vieja (el `estado` se agrego despues, asi que el carrito persistido no lo trae) y un
   * pedido que el staff cancelo mientras el cliente no abria el seguimiento — ahi no hay WebSocket ni
   * polling que avisen.
   *
   * Con `estado` en `undefined` el banner no tiene con que decidir, asi que se le pregunta al backend
   * UNA vez: si el pedido ya esta cerrado se suelta. Una sola consulta por pedido: en cuanto el estado
   * llega queda en el store (y persistido), y esta guarda no vuelve a dispararse.
   */
  const sinEstado = vigente && pedido?.estado === undefined
  React.useEffect(() => {
    if (!linkToken || !sinEstado) return undefined
    let vivo = true
    void (async () => {
      try {
        const r = await pedidosApi.publico(linkToken)
        if (!vivo || !r?.estado) return
        despachar({ tipo: 'PEDIDO_ESTADO', estado: r.estado })
        if (esFinal(r.estado)) despachar({ tipo: 'OLVIDAR_PEDIDO' })
      } catch (e) {
        // Un fallo terminal (404/410) tambien suelta: mismo criterio que el seguimiento.
        const { status, mensaje } = normalizarError(e)
        if (
          status !== 0 &&
          debeOlvidarPedido(clasificarFalloPedido(status, mensaje), linkToken, linkToken)
        ) {
          despachar({ tipo: 'OLVIDAR_PEDIDO' })
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [linkToken, sinEstado, despachar])

  if (!linkToken || !vigente) return null

  return (
    <Link
      href={`/${slugNegocio}/pedido/${linkToken}`}
      className="fixed inset-x-4 z-50 flex min-h-12 items-center justify-between gap-3 rounded-full border bg-card px-4 text-sm shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4rem + 1rem)' }}
    >
      <span>Ver estado de tu pedido</span>
      <span aria-hidden>&rsaquo;</span>
    </Link>
  )
}
