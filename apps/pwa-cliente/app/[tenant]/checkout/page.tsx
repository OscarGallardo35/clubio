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
import { useCliente } from '@/hooks/useCliente'

export default function CheckoutPage() {
  const params = useParams<{ tenant?: string }>()
  const router = useRouter()
  const slugNegocio = params?.tenant ?? ''
  const { enviar, enviando } = useCheckout()
  const despachar = useCarritoStore((s) => s.despachar)
  const { sucursal, slugParaApi } = useSucursalActiva()
  // La hidratacion del carrito es MANUAL (skipHydration) y asincrona: hasta que `activar` no
  // resuelve, el store puede mostrar su estado inicial (vacio). El redirect por carrito vacio
  // espera esta senal, no un temporizador.
  const [carritoListo, setCarritoListo] = React.useState(false)
  const activar = useCarritoStore((s) => s.activar)

  // El store usa `skipHydration`, asi que NADIE lo hidrata solo: hay que llamar a `activar`, que es
  // lo que hace CartaDigital en el menu. Sin esto, entrar directo a /checkout (URL a mano, recarga,
  // incognito) deja el carrito vacio de verdad y el redirect a /menu se dispara siempre.
  React.useEffect(() => {
    let vivo = true
    void activar(slugNegocio, sucursal?.id ?? null, sucursal?.slug ?? null)
      .then(() => { if (vivo) setCarritoListo(true) })
    return () => { vivo = false }
  }, [activar, slugNegocio, sucursal?.id, sucursal?.slug])
  // Auto-login del cliente: `useCliente` pega a GET /auth/cliente/me al montar (la sesion viaja en
  // la cookie HttpOnly). Si hay 200, se prellenan nombre y telefono; si es 401, `resuelto` queda en
  // true con `cliente` en null y no se toca nada.
  const { cliente: clienteSesion, resuelto: sesionResuelta } = useCliente()
  React.useEffect(() => {
    if (!sesionResuelta || !clienteSesion) return
    despachar({
      tipo: 'PRELLENAR_CLIENTE',
      datos: { nombre: clienteSesion.nombre, telefono: clienteSesion.telefono },
    })
  }, [sesionResuelta, clienteSesion?.id, clienteSesion?.nombre, clienteSesion?.telefono, despachar])

  // `useCarta` aca es solo para tener el refetch del cache: la carta en si la muestra /menu.
  const { refetch } = useCarta(slugNegocio, slugParaApi)

  const recargarCarta = React.useCallback(() => {
    refetch()                                    // invalida cache y trae la carta nueva
    despachar({ tipo: 'LIMPIAR' })               // los precios pueden haber cambiado
    toast('La carta cambió. Revisá los precios y armá tu pedido de nuevo.')
    router.push(`/${slugNegocio}/menu`)
  }, [refetch, despachar, router, slugNegocio])

  return (
    // El error y el `enviando` los lee el propio componente del store; aca solo se le da el
    // disparador, que es el hook.
    <PantallaCheckout
      slugNegocio={slugNegocio}
      enviando={enviando}
      onEnviar={async () => {
        // La navegacion sale del handler que la motiva, no de observar estado persistido: si sale de
        // un effect, el linkToken de un pedido viejo (que sobrevive en localStorage) redirige solo.
        const t = await enviar()
        if (t) router.replace(`/${slugNegocio}/pedido/${t}`)
      }}
      onRecargarCarta={recargarCarta}
      sucursalId={sucursal?.id ?? null}
      carritoListo={carritoListo}
    />
  )
}
