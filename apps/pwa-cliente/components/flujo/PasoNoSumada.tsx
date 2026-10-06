'use client'

import * as React from 'react'
import { Button } from '@repo/ui'
import { IconoAlerta, IconoReloj } from './iconos'
import type { MotivoNoSumada } from '@/lib/visita-maquina'

export interface PasoNoSumadaProps {
  motivo: MotivoNoSumada | null
  texto: string | null
  /** Horas que faltan cuando el motivo es 'esperaHoras' (lo calcula el backend). */
  faltanHoras?: number | null | undefined
  onReintentar: () => void
  onVerTarjeta: () => void
  onVolverMenu: () => void
}

/**
 * Pantallas donde la visita NO se sumo pero el flujo sigue vivo.
 *
 * Cada motivo tiene su copy Y su accion. Reintentar solo tiene sentido si la solicitud vencio:
 * cuando el limite de horas o el limite diario ya se consumieron, el backend va a contestar 400
 * otra vez, asi que ofrecer el boton es mandar al cliente contra una pared.
 */
export function PasoNoSumada({ motivo, texto, faltanHoras, onReintentar, onVerTarjeta, onVolverMenu }: PasoNoSumadaProps) {
  const puedeReintentar = motivo === 'expirada'
  const esRechazo = motivo === 'rechazada'
  const esEspera = motivo === 'esperaHoras'
  const esYaSumada = motivo === 'yaSumadaHoy'

  const titulo = esRechazo
    ? 'No pudimos validar tu visita'
    : esEspera
      ? 'Todavia no podes sumar otra visita'
      : esYaSumada
        ? 'Ya sumaste tu visita hoy'
        : 'No se sumo esta vez'

  const detalle = esEspera
    ? faltanHoras && faltanHoras > 0
      ? `Podes volver en ~${faltanHoras} ${faltanHoras === 1 ? 'hora' : 'horas'}.`
      : 'Todavia no paso el tiempo minimo entre visitas.'
    : esYaSumada
      ? 'Ya sumaste tu visita hoy. Nos vemos manana.'
      : (texto ?? 'No pudimos sumar tu visita.')

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-white/15 text-white">
        {esRechazo ? <IconoAlerta className="size-8" /> : <IconoReloj className="size-8" />}
      </div>

      <h1 className="text-xl font-bold text-white drop-shadow">
        {titulo}
      </h1>

      <p className="w-full rounded-2xl bg-white/95 px-4 py-3 text-sm shadow-xl" role="status">
        {detalle}
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
