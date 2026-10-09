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
  /** Devuelve el `linkToken` del pedido creado, o `null` si no se mando (guard, validacion, error). */
  enviar: () => Promise<string | null>
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

  /**
   * Manda el pedido. Devuelve el `linkToken` si salio bien y `null` si no (error, guard, validacion):
   * el que navega al seguimiento es el QUE LLAMA, en el handler de la accion. Antes la pagina tenia
   * un effect que observaba `pedido.linkToken` y eso la eyectaba al tracking de un pedido VIEJO
   * (el linkToken se persiste a proposito, y al rehidratar volvia a aparecer).
   * El hook sigue despachando PEDIDO_OK para que el linkToken quede persistido y el banner "Ver
   * estado de tu pedido" siga funcionando.
   */
  const enviar = useCallback(async (): Promise<string | null> => {
    const estado = useCarritoStore.getState()
    // Guard anti-doble-tap. OJO: este es el UNICO lugar que mueve la fase a 'enviando' (el
    // componente no la adelanta), asi que llegar aca con 'enviando' significa un segundo toque.
    if (estado.fase === 'enviando' || estado.fase === 'enviado') return null
    if (Object.keys(validarCheckout(estado)).length > 0) return null

    despachar({ tipo: 'ENVIAR' })
    try {
      const body = armarBody(estado)
      const r = await crearConReintento(body)
      // SOLO PEDIDO_OK. Ver el comentario del encabezado.
      despachar({
        tipo: 'PEDIDO_OK',
        linkToken: r.linkToken,
        // Vienen de la respuesta del POST y no del GET publico: se guardan para que el boton de
        // WhatsApp siga estando despues de recargar.
        urlCorta: r.urlCorta,
        mensajeWhatsApp: r.mensajeWhatsApp,
        // El vencimiento del link: es lo que le permite al banner del menu saber si todavia sirve.
        expiraEn: r.expiraEn,
      })
      return r.linkToken
    } catch (e) {
      // No es un log temporal: un error de envio no puede quedar silencioso (el estado se quedaria
      // atrapado en 'enviando' sin que nadie se entere).
      console.error('[checkout] el envio del pedido fallo:', e)
      const { status, mensaje, data } = normalizarError(e)
      // LOG TEMPORAL - diagnostico del crash post-400. OJO: `e.mensaje` no existe (el crudo no tiene
      // ese campo); los valores normalizados son los que se despachan, y `crudo` va entero por si el
      // status no es el que parece.
      console.log('[checkout] pre-despacho:', { status, mensaje, crudo: e })
      despachar({ tipo: 'PEDIDO_ERROR', status, mensaje, data })
      return null
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
