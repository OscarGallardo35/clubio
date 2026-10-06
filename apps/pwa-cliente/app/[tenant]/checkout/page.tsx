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
import { toast } from '@repo/ui'
import { useCarritoStore } from '@/stores/carritoStore'
import { useCarta } from '@/hooks/useCarta'
import { useSucursalActiva } from '@/hooks/useSucursalActiva'

export default function CheckoutPage() {
  const params = useParams<{ tenant?: string }>()
  const router = useRouter()
  const slugNegocio = params?.tenant ?? ''
  const { enviar, enviando } = useCheckout()
  const linkToken = useCarritoStore((s) => s.pedido?.linkToken ?? null)
  const despachar = useCarritoStore((s) => s.despachar)
  const { sucursal, slugParaApi } = useSucursalActiva()
  const activar = useCarritoStore((s) => s.activar)

  // El store usa `skipHydration`, asi que NADIE lo hidrata solo: hay que llamar a `activar`, que es
  // lo que hace CartaDigital en el menu. Sin esto, entrar directo a /checkout (URL a mano, recarga,
  // incognito) deja el carrito vacio de verdad y el redirect a /menu se dispara siempre.
  React.useEffect(() => {
    // LOG TEMPORAL - sacar despues del diagnostico
    console.log('[checkout] activar con:', { slugNegocio, sucursalId: sucursal?.id ?? null, sucursalSlug: sucursal?.slug ?? null })
    void activar(slugNegocio, sucursal?.id ?? null, sucursal?.slug ?? null)
  }, [activar, slugNegocio, sucursal?.id, sucursal?.slug])
  // `useCarta` aca es solo para tener el refetch del cache: la carta en si la muestra /menu.
  const { refetch } = useCarta(slugNegocio, slugParaApi)

  const recargarCarta = React.useCallback(() => {
    refetch()                                    // invalida cache y trae la carta nueva
    despachar({ tipo: 'LIMPIAR' })               // los precios pueden haber cambiado
    toast('La carta cambió. Revisá los precios y armá tu pedido de nuevo.')
    router.push(`/${slugNegocio}/menu`)
  }, [refetch, despachar, router, slugNegocio])

  // PEDIDO_OK dejó el linkToken en el store: se navega al seguimiento. El checkout NO despacha
  // LIMPIAR (PEDIDO_OK ya vació el carrito y conserva el linkToken).
  React.useEffect(() => {
    if (linkToken) router.replace(`/${slugNegocio}/pedido/${linkToken}`)
  }, [linkToken, router, slugNegocio])

  return (
    // El error y el `enviando` los lee el propio componente del store; aca solo se le da el
    // disparador, que es el hook.
    <PantallaCheckout
      slugNegocio={slugNegocio}
      enviando={enviando}
      onEnviar={() => void enviar()}
      onRecargarCarta={recargarCarta}
    />
  )
}
