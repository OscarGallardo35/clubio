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
   * Tercera guarda: el store puede tener un estado VIEJO o inexistente, y el banner se lo cree.
   * Tres casos reales, todos con el link todavia vigente:
   *   - una pestana vieja (el `estado` se agrego despues y el carrito persistido no lo trae);
   *   - el staff cancelo el pedido mientras el cliente no tenia el seguimiento abierto (en /menu no
   *     hay WebSocket ni polling que avisen);
   *   - un `PENDIENTE` de una sesion anterior que ya no es cierto.
   *
   * Asi que siempre que el banner se muestre se le pregunta al backend UNA vez: si el pedido ya esta
   * cerrado se suelta, si el GET falla con 404/410 tambien (mismo criterio que el seguimiento) y si
   * sigue vivo se sincroniza el estado. Es un solo GET por montaje del banner (menu/club), el mismo
   * que hace el seguimiento, y el resultado queda persistido.
   */
  const verificar = vigente && Boolean(linkToken)
  React.useEffect(() => {
    if (!linkToken || !verificar) return undefined
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
  }, [linkToken, verificar, despachar])

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
