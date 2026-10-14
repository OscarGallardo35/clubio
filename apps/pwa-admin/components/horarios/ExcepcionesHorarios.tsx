'use client'

/**
 * Feriados / cierre temporal ("hoy cerrado", "cerrar hasta...").
 *
 * Cada excepcion es una fila de `ExcepcionHorario` (rango de fechas INCLUSIVE) que CIERRA el
 * local entero (atencion y delivery). Se gestiona aparte de la grilla semanal porque es por
 * fecha: la tabla crece y se consulta por rango.
 */
import * as React from 'react'
import { Button, Input, Label, Skeleton, toast } from '@repo/ui'
import { horariosApi } from '@/lib/api'
import { normalizarError } from '@/lib/errores'
import type { ExcepcionHorario } from '@/types/api'

function hoyAr(): string {
  // 'en-CA' da YYYY-MM-DD; con America/Argentina/Buenos_Aires respeta la TZ del local.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export interface ExcepcionesHorariosProps {
  /** `undefined` = excepciones del local (todas las sucursales). */
  sucursalId?: string | undefined
}

export function ExcepcionesHorarios({ sucursalId }: ExcepcionesHorariosProps) {
  const [filas, setFilas] = React.useState<ExcepcionHorario[] | null>(null)
  const [desde, setDesde] = React.useState(hoyAr())
  const [hasta, setHasta] = React.useState(hoyAr())
  const [motivo, setMotivo] = React.useState('')
  const [ocupado, setOcupado] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refetch = React.useCallback(async () => {
    try {
      const todas = await horariosApi.excepciones()
      // El panel del club muestra las GLOBALES; el de la sucursal, las de esa sucursal.
      setFilas(todas.filter((e) => (sucursalId ? e.sucursalId === sucursalId : e.sucursalId === null)))
      setError(null)
    } catch (e) {
      setError(normalizarError(e).mensaje)
    }
  }, [sucursalId])

  React.useEffect(() => {
    void refetch()
  }, [refetch])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    if (ocupado) return
    if (hasta < desde) {
      setError('La fecha de fin no puede ser anterior a la de inicio')
      return
    }
    setOcupado(true)
    setError(null)
    try {
      await horariosApi.crearExcepcion({
        desdeFecha: desde,
        hastaFecha: hasta,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        ...(sucursalId ? { sucursalId } : {}),
      })
      setMotivo('')
      toast.success('Cierre agregado')
      await refetch()
    } catch (err) {
      setError(normalizarError(err).mensaje)
    } finally {
      setOcupado(false)
    }
  }

  async function quitar(id: string) {
    setOcupado(true)
    try {
      await horariosApi.eliminarExcepcion(id)
      await refetch()
    } catch (err) {
      setError(normalizarError(err).mensaje)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Cierres y feriados</Label>
        <p className="text-xs text-muted-foreground">
          El local queda cerrado esos dias (tambien el delivery). Util para feriados o para cerrar
          hoy / hasta tal fecha.
        </p>
      </div>

      {filas === null ? (
        <Skeleton className="h-16 w-full" />
      ) : filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay cierres cargados.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {filas.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {f.desdeFecha.slice(0, 10) === f.hastaFecha.slice(0, 10)
                    ? formatearFecha(f.desdeFecha)
                    : `${formatearFecha(f.desdeFecha)} al ${formatearFecha(f.hastaFecha)}`}
                </p>
                {f.motivo ? <p className="truncate text-xs text-muted-foreground">{f.motivo}</p> : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-10 shrink-0"
                disabled={ocupado}
                onClick={() => void quitar(f.id)}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={agregar} className="space-y-3 rounded-xl border border-dashed p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`exc-desde-${sucursalId ?? 'club'}`}>Desde</Label>
            <Input
              id={`exc-desde-${sucursalId ?? 'club'}`}
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value)
                if (e.target.value > hasta) setHasta(e.target.value)
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`exc-hasta-${sucursalId ?? 'club'}`}>Hasta</Label>
            <Input
              id={`exc-hasta-${sucursalId ?? 'club'}`}
              type="date"
              min={desde}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`exc-motivo-${sucursalId ?? 'club'}`}>Motivo (opcional)</Label>
          <Input
            id={`exc-motivo-${sucursalId ?? 'club'}`}
            value={motivo}
            maxLength={120}
            placeholder="Feriado / vacaciones"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={ocupado}>
          {ocupado ? 'Guardando...' : 'Agregar cierre'}
        </Button>
      </form>
    </div>
  )
}
