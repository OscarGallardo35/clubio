'use client'

/**
 * Seguimiento del pedido. El linkToken viene en la URL, asi que la pagina se puede compartir y
 * sobrevive a un recargado sin depender del store.
 */
import { useParams } from 'next/navigation'
import { Seguimiento } from '@/components/checkout/Seguimiento'

export default function PedidoPage() {
  const params = useParams<{ tenant?: string; linkToken?: string }>()
  const slugNegocio = params?.tenant ?? ''
  const linkToken = params?.linkToken ?? ''

  if (!linkToken) return null
  return <Seguimiento linkToken={linkToken} slugNegocio={slugNegocio} />
}
