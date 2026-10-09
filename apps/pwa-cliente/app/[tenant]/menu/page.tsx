'use client'

/**
 * Carta digital de la sucursal activa (QR #1, etapa 3).
 *
 * El negocio y la sucursal salen de los contextos que ya resolvio el layout del tenant: aca no
 * se vuelve a pedir nada. El gating de la feature (banner si entran por URL sin menu) es del
 * paso 4.
 */
import { CartaDigital } from '@/components/carta/CartaDigital'
import { BannerInstalacion } from '@repo/ui'
import { useBranding } from '@/hooks/useBranding'
import { useSucursalActiva } from '@/hooks/useSucursalActiva'

export default function MenuPage() {
  const { negocio } = useBranding()
  const { sucursal } = useSucursalActiva()

  if (!negocio) return null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-24">
      <h1 className="text-xl font-semibold">Carta</h1>
      {/* Instalacion guiada de la PWA: ARRIBA de la carta. Antes estaba como footer y quedaba
          debajo del scroll (a 375px el banner arrancaba en y=1015 de un documento de 1328), o sea
          invisible salvo que bajaran toda la carta. Se auto-oculta si ya esta instalada o si el
          usuario lo descarto (30 dias). */}
      <BannerInstalacion nombreApp={negocio.nombre ?? 'Clubio'} />
      <CartaDigital
        negocioSlug={negocio.slug}
        sucursalSlug={sucursal?.slug ?? null}
        sucursalId={sucursal?.id ?? null}
        colorMarca={negocio.colorPrimario ?? undefined}
      />
    </main>
  )
}
