'use client'

/**
 * Aviso para cuando alguien entra por URL a una funcion que su negocio no tiene.
 *
 * No decide nada: el llamador ya evaluo el gating (con `menuDisponible` de useBranding) y
 * renderiza esto en lugar del contenido. El link de vuelta se arma con el tenant de la ruta.
 */
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { buttonVariants } from '@repo/ui'

export interface GatingBannerProps {
  /** Que funcion esta bloqueada, en palabras del negocio ("la carta digital"). */
  featureBloqueada: string
  negocioNombre: string
}

export function GatingBanner({ featureBloqueada, negocioNombre }: GatingBannerProps) {
  const params = useParams<{ tenant?: string }>()
  const tenant = params?.tenant
  const href = tenant ? `/${tenant}/club` : '/'

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center">
      <p className="text-base font-medium">
        Esta funcion no esta disponible en el plan de {negocioNombre}
      </p>
      <p className="text-sm text-muted-foreground">
        {featureBloqueada} se activa desde el panel del negocio.
      </p>
      {/* Button no tiene asChild: se aplican sus clases a un Link real, para que navegue. */}
      <Link href={href} className={buttonVariants({ className: 'min-h-12' })}>
        Volver al inicio
      </Link>
    </div>
  )
}
