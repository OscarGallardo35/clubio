'use client'

/**
 * Orquestador del checkout: es el UNICO lugar que pega al backend con el pedido.
 *
 * El estado de "enviando" NO vive aca: sale de `fase` del store (`'enviando'`), asi que el mismo
 * flag que pinta el spinner es el que bloquea el segundo envio. Aca no hay `useState` mas que el
 * necesario.
 *
 * En el exito se despacha SOLO `PEDIDO_OK`: ese caso ya vacia el carrito y conserva `pedido`,
 * `cliente`, `tipo` y `modoPago`. Un `LIMPIAR` adicional borraria el `linkToken` recien guardado y
 * se perderia el seguimiento al recargar (ver TROUBLESHOOTING, "eventos en secuencia").
 */
import { useCallback } from 'react'
import { useCarritoStore } from '@/stores/carritoStore'
import { pedidosApi } from '@/lib/api'
import { armarBody, normalizarError } from '@/lib/checkout-maquina'
import { validarCheckout } from '@/lib/carrito-maquina'
import type { ErrorCarrito } from '@/lib/carrito-maquina'
import type { CrearPedidoBody, PedidoCreadoRespuesta } from '@/types/api'

export interface UsoCheckout {
  enviar: () => Promise<void>
  enviando: boolean
  error: ErrorCarrito | null
  limpiarError: () => void
  limpiar: () => void
}

const ESPERA_REINTENTO_MS = 1000

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Un unico reintento, y solo para errores de red (status 0): esos se resuelven solos si el
 * telefono recupera conexion. Un 429 NO se reintenta (empeoraria el rate limit) y un 400 tampoco
 * (los datos no van a cambiar por esperar).
 */
async function crearConReintento(body: CrearPedidoBody): Promise<PedidoCreadoRespuesta> {
  try {
    return await pedidosApi.crear(body)
  } catch (e) {
    const { status } = normalizarError(e)
    if (status !== 0) throw e
    await dormir(ESPERA_REINTENTO_MS)
    return await pedidosApi.crear(body)
  }
}

export function useCheckout(): UsoCheckout {
  const despachar = useCarritoStore((s) => s.despachar)
  const fase = useCarritoStore((s) => s.fase)
  const error = useCarritoStore((s) => s.error)

  const enviar = useCallback(async () => {
    const estado = useCarritoStore.getState()
    // El reducer tambien lo frena, pero cortar aca evita armar el body al pedo.
    if (estado.fase === 'enviando' || estado.fase === 'enviado') return
    if (Object.keys(validarCheckout(estado)).length > 0) return

    despachar({ tipo: 'ENVIAR' })
    try {
      const r = await crearConReintento(armarBody(estado))
      // SOLO PEDIDO_OK. Ver el comentario del encabezado.
      despachar({ tipo: 'PEDIDO_OK', linkToken: r.linkToken })
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      despachar({ tipo: 'PEDIDO_ERROR', status, mensaje })
    }
  }, [despachar])

  return {
    enviar,
    enviando: fase === 'enviando',
    error,
    limpiarError: useCallback(() => despachar({ tipo: 'REINTENTAR' }), [despachar]),
    limpiar: useCallback(() => despachar({ tipo: 'LIMPIAR' }), [despachar]),
  }
}
