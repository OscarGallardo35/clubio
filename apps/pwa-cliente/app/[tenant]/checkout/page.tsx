'use client'

/**
 * Checkout del tenant.
 *
 * Es client porque la pantalla depende del carrito (localStorage) y del hook que pega al backend.
 * No hay resumen SSR: el carrito vive en el cliente, asi que el servidor no puede saber que items
 * hay (ver el encabezado de PantallaCheckout).
 */
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PantallaCheckout } from '@/components/checkout/PantallaCheckout'
import { useCheckout } from '@/hooks/useCheckout'
import { useCarritoStore } from '@/stores/carritoStore'

export default function CheckoutPage() {
  const params = useParams<{ tenant?: string }>()
  const router = useRouter()
  const slugNegocio = params?.tenant ?? ''
  const { enviar, enviando } = useCheckout()
  const linkToken = useCarritoStore((s) => s.pedido?.linkToken ?? null)

  // PEDIDO_OK dejó el linkToken en el store: se navega al seguimiento. El checkout NO despacha
  // LIMPIAR (PEDIDO_OK ya vació el carrito y conserva el linkToken).
  React.useEffect(() => {
    if (linkToken) router.replace(`/${slugNegocio}/pedido/${linkToken}`)
  }, [linkToken, router, slugNegocio])

  return (
    // El error y el `enviando` los lee el propio componente del store; aca solo se le da el
    // disparador, que es el hook.
    <PantallaCheckout slugNegocio={slugNegocio} enviando={enviando} onEnviar={() => void enviar()} />
  )
}
