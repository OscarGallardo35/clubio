'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@repo/ui'
import { BrandingProvider } from '@/components/BrandingProvider'
import { SucursalProvider } from '@/components/SucursalProvider'
import { useBrandingStore } from '@/stores/brandingStore'

/**
 * Camino de respaldo de las rutas sin tenant en la URL.
 *
 * El servidor ya intento resolver el negocio con la cookie; si no pudo, aca se
 * usa el branding persistido (el ultimo local que se miro en este dispositivo).
 * Sin nada persistido no hay forma de saber que mostrar: se vuelve al inicio.
 */
export function GuardiaDeSesion({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const negocio = useBrandingStore((s) => s.negocio)
  const [listo, setListo] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    // skipHydration: la rehidratacion se dispara a mano para no romper el HTML
    // del servidor con un render distinto en el cliente.
    // rehydrate() esta tipado como void | Promise<void>: se envuelve para poder
    // esperarlo en los dos casos.
    void Promise.resolve(useBrandingStore.persist.rehydrate()).finally(() => {
      if (vivo) setListo(true)
    })
    return () => {
      vivo = false
    }
  }, [])

  React.useEffect(() => {
    if (!listo) return
    if (!negocio) router.replace('/?motivo=sin-local')
  }, [listo, negocio, router])

  if (!listo) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </main>
    )
  }

  // Sin negocio: el redirect ya esta en curso, no se renderiza contenido.
  if (!negocio) return null

  return (
    <BrandingProvider negocioInicial={negocio} tenant={negocio.slug}>
      <SucursalProvider>{children}</SucursalProvider>
    </BrandingProvider>
  )
}
