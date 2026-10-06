'use client'

import { Button } from '@repo/ui'
import { IconoAlerta } from './iconos'

export interface PasoErrorProps {
  mensaje: string | null
  onReintentar: () => void
  onVolverMenu: () => void
}

/** Fallo real (red, backend caido, 400 inesperado). Nunca se llega aca por un
 *  "espera N horas" ni por "ya sumaste": esos tienen su propia pantalla. */
export function PasoError({ mensaje, onReintentar, onVolverMenu }: PasoErrorProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-white/15 text-white">
        <IconoAlerta className="size-8" />
      </div>

      <h1 className="text-xl font-bold text-white drop-shadow">Algo salió mal</h1>

      <p className="w-full rounded-2xl bg-white/95 px-4 py-3 text-sm shadow-xl" role="status">
        {mensaje ?? 'No pudimos sumar tu visita. Probá de nuevo en un momento.'}
      </p>

      <div className="flex w-full flex-col gap-3">
        <Button size="lg" className="min-h-12 text-base" onClick={onReintentar}>
          Reintentar
        </Button>
        <Button variant="ghost" className="min-h-12 text-white/90 hover:bg-white/10 hover:text-white" onClick={onVolverMenu}>
          Volver al menú
        </Button>
      </div>
    </div>
  )
}
