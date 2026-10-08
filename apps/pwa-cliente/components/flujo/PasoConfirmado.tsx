'use client'

import * as React from 'react'
import { Button, TarjetaSellos, toast } from '@repo/ui'
import { resumenDeAprobacion } from '@/lib/visita-maquina'
import type { SellosTrasAprobar } from '@/lib/visita-maquina'
import { BloqueResena } from './BloqueResena'
import { IconoCheck } from './iconos'

export interface PasoConfirmadoProps {
  nombreCliente: string | null
  nombreNegocio: string
  logoUrl?: string | null
  premioTexto: string
  actuales: number
  meta: number
  premioDesbloqueado: boolean
  colorPrimario: string
  colorSecundario: string
  mostrarResena: boolean
  placeId?: string | null
  /**
   * Lo que OTORGO la visita. Con HIBRIDO son dos incrementos; el modo decide cual se muestra.
   * Los tipos salen del payload del WS (`SellosTrasAprobar`), no se re-declaran aca.
   */
  modoFidelizacion?: SellosTrasAprobar['modoFidelizacion']
  sellosOtorgados?: SellosTrasAprobar['sellosOtorgados']
  puntosOtorgados?: SellosTrasAprobar['puntosOtorgados']
  /** Saldo de puntos DESPUES de la visita (para el "ahora tenes N puntos"). */
  puntosActuales?: SellosTrasAprobar['puntosActuales']
  onVerTarjeta: () => void
  onVolver: () => void
}

export function PasoConfirmado({
  nombreCliente,
  nombreNegocio,
  logoUrl,
  premioTexto,
  actuales,
  meta,
  premioDesbloqueado,
  colorPrimario,
  colorSecundario,
  mostrarResena,
  placeId,
  modoFidelizacion,
  sellosOtorgados,
  puntosOtorgados,
  puntosActuales,
  onVerTarjeta,
  onVolver,
}: PasoConfirmadoProps) {
  const completo = premioDesbloqueado || actuales >= meta

  // El texto de "que sumaste" sale de una funcion PURA (testeable sin renderizar). El modo manda:
  // con SOLO_VISITAS no se nombran puntos, y con SOLO_PUNTOS no se nombran sellos.
  const resumen = resumenDeAprobacion({
    sellosActuales: actuales,
    premioDesbloqueado: completo,
    ...(modoFidelizacion !== undefined ? { modoFidelizacion } : {}),
    ...(sellosOtorgados !== undefined ? { sellosOtorgados } : {}),
    ...(puntosOtorgados !== undefined ? { puntosOtorgados } : {}),
  })
  const modo = modoFidelizacion ?? 'SOLO_VISITAS'
  const saldoPuntos =
    modo !== 'SOLO_VISITAS' && typeof puntosActuales === 'number'
      ? `Ahora tenes ${puntosActuales} puntos`
      : null

  // Aviso no bloqueante al confirmar (la pantalla ya lo dice; el toast es el
  // "ya esta" para quien no esta mirando).
  React.useEffect(() => {
    toast.success(resumen ?? (completo ? '¡Completaste la tarjeta!' : '¡Sumaste tu visita!'), {
      description: completo
        ? `Ya podés canjear: ${premioTexto}`
        : saldoPuntos ?? `Vas ${actuales} de ${meta} sellos`,
    })
    // vibracion si el equipo la soporta (no hay sonido a proposito)
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(200)
    }
    // Solo al entrar a la pantalla: no se repite en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-8">
      <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
        <IconoCheck className="size-7" />
      </div>

      <h1 className="text-center text-2xl font-bold text-white drop-shadow">
        {resumen ?? (completo ? '¡Tarjeta completa!' : '¡Listo, sumaste tu visita!')}
      </h1>

      {saldoPuntos ? (
        <p role="status" className="text-center text-sm font-medium text-white/90">
          {saldoPuntos}
        </p>
      ) : null}

      <TarjetaSellos
        tamaño="medium"
        nombreNegocio={nombreNegocio}
        logoUrl={logoUrl ?? undefined}
        nombreCliente={nombreCliente ?? undefined}
        tipo="VISITAS"
        actuales={actuales}
        meta={meta}
        premioTexto={premioTexto}
        colorPrimario={colorPrimario}
        colorSecundario={colorSecundario}
        estado={completo ? 'completa' : 'progreso'}
      />

      {completo && (
        <p role="status" className="w-full rounded-2xl bg-white/95 px-4 py-3 text-center text-sm font-medium shadow-xl">
          Mostrá esta tarjeta en el local para canjear: {premioTexto}
        </p>
      )}

      {mostrarResena && placeId && <BloqueResena placeId={placeId} nombreNegocio={nombreNegocio} />}

      <div className="flex w-full flex-col gap-3">
        <Button size="lg" className="min-h-12 text-base" onClick={onVerTarjeta}>
          Ver mi tarjeta
        </Button>
        <Button
          variant="ghost"
          className="min-h-12 text-white/90 hover:bg-white/10 hover:text-white"
          onClick={onVolver}
        >
          Volver al menú
        </Button>
      </div>
    </div>
  )
}
