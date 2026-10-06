'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@repo/ui'
import { useBrandingStore } from '@/stores/brandingStore'
import { RUTAS } from '@/lib/constants'

/**
 * Inicio.
 *
 * Es tambien el start_url del manifest: si este dispositivo ya miro un local
 * (branding persistido), se entra directo al club. Si no, queda el mensaje de
 * "escanea el QR", que es lo unico honesto cuando no se sabe el local.
 *
 * No se resuelve en el servidor a proposito: depende de localStorage.
 */
export default function Inicio() {
  const router = useRouter()
  const negocio = useBrandingStore((s) => s.negocio)
  const [listo, setListo] = React.useState(false)
  const [sinLocal, setSinLocal] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    setSinLocal(new URLSearchParams(window.location.search).get('motivo') === 'sin-local')
    void Promise.resolve(useBrandingStore.persist.rehydrate()).finally(() => {
      if (vivo) setListo(true)
    })
    return () => {
      vivo = false
    }
  }, [])

  React.useEffect(() => {
    if (listo && negocio) router.replace(RUTAS.club(negocio.slug))
  }, [listo, negocio, router])

  if (!listo || negocio) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Escaneá el QR del local</h1>
      <p className="text-muted-foreground">
        {sinLocal
          ? 'Primero escaneá el QR del local para saber qué tarjeta mostrarte.'
          : 'Pedí el QR de la carta o del club al personal para ver el menú o sumar tu visita.'}
      </p>
    </main>
  )
}
