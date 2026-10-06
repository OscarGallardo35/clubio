'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@repo/ui'
import { useBranding } from '@/hooks/useBranding'
import { FlujoVisita } from '@/components/flujo/FlujoVisita'

/**
 * QR #2.
 *
 * NO vuelve a resolver el tenant: el layout ya lo trajo del servidor y lo dejo en
 * el BrandingProvider, asi que aca solo se lee (cero fetch de negocio).
 *
 * Si no hay negocio (ni del layout ni persistido) y ya no esta cargando, no hay
 * nada que mostrar: se vuelve al inicio con el motivo.
 */
export default function ClubPage() {
  const router = useRouter()
  const { negocio, cargando } = useBranding()

  React.useEffect(() => {
    if (!cargando && !negocio) router.replace('/?motivo=sin-local')
  }, [cargando, negocio, router])

  if (!negocio) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return <FlujoVisita />
}
