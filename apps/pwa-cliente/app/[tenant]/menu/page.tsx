import { Placeholder } from '@/components/Placeholder'

export const metadata = { title: 'Carta' }

/** QR #1. Acá va la carta digital con modificadores, upsell y checkout. */
export default function MenuPage() {
  return (
    <Placeholder
      titulo="Carta"
      detalle="QR #1: acá va la carta (GET /carta?sucursalSlug=), con modificadores, upsell, carrito y checkout."
    />
  )
}
