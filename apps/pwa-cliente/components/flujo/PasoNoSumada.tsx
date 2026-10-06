'use client'

import * as React from 'react'
import { Button } from '@repo/ui'
import { IconoAlerta, IconoReloj } from './iconos'
import type { MotivoNoSumada } from '@/lib/visita-maquina'

export interface PasoNoSumadaProps {
  motivo: MotivoNoSumada | null
  texto: string | null
  onReintentar: () => void
  onVerTarjeta: () => void
  onVolverMenu: () => void
}

/**
 * Pantallas donde la visita NO se sumo pero el flujo sigue vivo.
 *
 * Cada motivo tiene su accion: reintentar solo tiene sentido si la solicitud
 * vencio; si el limite ya se consumio, reintentar no sirve y se ofrece la tarjeta.
 */
export function PasoNoSumada({ motivo, texto, onReintentar, onVerTarjeta, onVolverMenu }: PasoNoSumadaProps) {
  const puedeReintentar = motivo === 'expirada'
  const esRechazo = motivo === 'rechazada'

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-white/15 text-white">
        {esRechazo ? <IconoAlerta className="size-8" /> : <IconoReloj className="size-8" />}
      </div>

      <h1 className="text-xl font-bold text-white drop-shadow">
        {esRechazo ? 'No pudimos validar tu visita' : 'No se sumó esta vez'}
      </h1>

      <p className="w-full rounded-2xl bg-white/95 px-4 py-3 text-sm shadow-xl" role="status">
        {texto ?? 'No pudimos sumar tu visita.'}
      </p>

      <div className="flex w-full flex-col gap-3">
        {puedeReintentar && (
          <Button size="lg" className="min-h-12 text-base" onClick={onReintentar}>
            Intentar de nuevo
          </Button>
        )}
        <Button
          variant={puedeReintentar ? 'outline' : 'default'}
          size="lg"
          className={'min-h-12 text-base' + (puedeReintentar ? ' border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white' : '')}
          onClick={onVerTarjeta}
        >
          Ver mi tarjeta
        </Button>
        <Button variant="ghost" className="min-h-12 text-white/90 hover:bg-white/10 hover:text-white" onClick={onVolverMenu}>
          Volver al menú
        </Button>
      </div>
    </div>
  )
}
