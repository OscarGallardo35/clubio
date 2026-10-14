'use client'

/**
 * Editor SEMANAL de horarios (mobile-first).
 *
 * Una fila por dia (Lun..Dom) con el resumen ("12:00-15:00, 20:00-23:00" o "Cerrado") y un
 * boton para editar la jornada en un BottomSheet (los inputs de hora y la lista de franjas no
 * entran comodos inline a 375px). Sin drag & drop: todo son `<input type="time">` y botones.
 *
 * El valor es `HorarioSemana | null`: `null` = SIN horarios (el local esta siempre abierto) y
 * es el DEFAULT del backend, asi que el switch arranca apagado para quien nunca configuro.
 */
import * as React from 'react'
import {
  BottomSheet,
  Button,
  Input,
  Label,
  Switch,
} from '@repo/ui'
import type { DiaSemana, HorarioSemana, RangoHorario } from '@/types/api'

const DIAS: { clave: DiaSemana; nombre: string }[] = [
  { clave: 'lun', nombre: 'Lunes' },
  { clave: 'mar', nombre: 'Martes' },
  { clave: 'mie', nombre: 'Miercoles' },
  { clave: 'jue', nombre: 'Jueves' },
  { clave: 'vie', nombre: 'Viernes' },
  { clave: 'sab', nombre: 'Sabado' },
  { clave: 'dom', nombre: 'Domingo' },
]

/** Grilla inicial al encender el switch: una franja de mediodia en todos los dias. */
const SEMANA_INICIAL: HorarioSemana = {
  lun: [{ desde: '12:00', hasta: '15:00' }],
  mar: [{ desde: '12:00', hasta: '15:00' }],
  mie: [{ desde: '12:00', hasta: '15:00' }],
  jue: [{ desde: '12:00', hasta: '15:00' }],
  vie: [{ desde: '12:00', hasta: '15:00' }],
  sab: [{ desde: '12:00', hasta: '15:00' }],
  dom: [{ desde: '12:00', hasta: '15:00' }],
}

function resumen(rangos: RangoHorario[] | undefined): string {
  if (!rangos || rangos.length === 0) return 'Cerrado'
  return rangos.map((r) => `${r.desde} a ${r.hasta}`).join(' · ')
}

/** Valida la hora en el formato que exige el backend ('HH:mm' con cero a la izquierda). */
function horaValida(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

export interface EditorHorariosSemanaProps {
  /** Etiqueta del switch superior ("Horarios de atencion"). */
  etiqueta: string
  ayuda?: string
  valor: HorarioSemana | null
  onChange: (valor: HorarioSemana | null) => void
  /** Si viene, se muestra "volver a heredar" (override de sucursal). */
  onHeredar?: (() => void) | undefined
  etiquetaHeredar?: string
}

export function EditorHorariosSemana({
  etiqueta,
  ayuda,
  valor,
  onChange,
  onHeredar,
  etiquetaHeredar,
}: EditorHorariosSemanaProps) {
  const activo = valor !== null
  const [diaAbierto, setDiaAbierto] = React.useState<DiaSemana | null>(null)

  const semana = valor ?? SEMANA_INICIAL

  const setDia = React.useCallback(
    (dia: DiaSemana, rangos: RangoHorario[]) => {
      // Se normaliza a TODOS los dias presentes (un dia ausente es "cerrado", pero el editor
      // siempre manda los 7 para que el estado sea explicito y no dependa de huecos).
      const base: HorarioSemana = { ...SEMANA_INICIAL, ...semana }
      onChange({ ...base, [dia]: rangos })
    },
    [onChange, semana],
  )

  const copiarATodos = React.useCallback(
    (rangos: RangoHorario[]) => {
      const copia: HorarioSemana = {}
      for (const d of DIAS) copia[d.clave] = rangos.map((r) => ({ ...r }))
      onChange(copia)
    },
    [onChange],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Label htmlFor={`horario-${etiqueta}`}>{etiqueta}</Label>
          {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
        </div>
        <Switch
          id={`horario-${etiqueta}`}
          checked={activo}
          onCheckedChange={(v) => onChange(v ? (valor ?? SEMANA_INICIAL) : null)}
          aria-label={`Definir ${etiqueta}`}
        />
      </div>

      {!activo ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Sin horarios: el local esta <strong>siempre abierto</strong>.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border">
            {DIAS.map((d) => {
              const rangos = semana[d.clave] ?? []
              const cerrado = rangos.length === 0
              return (
                <li key={d.clave} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{d.nombre}</p>
                    <p className={`truncate text-xs ${cerrado ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {resumen(rangos)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 shrink-0"
                    onClick={() => setDiaAbierto(d.clave)}
                  >
                    Editar
                  </Button>
                </li>
              )
            })}
          </ul>

          {onHeredar ? (
            <Button type="button" variant="ghost" className="min-h-11" onClick={onHeredar}>
              {etiquetaHeredar ?? 'Volver a heredar del club'}
            </Button>
          ) : null}

          {diaAbierto ? (
            <EditorDia
              dia={DIAS.find((d) => d.clave === diaAbierto)?.nombre ?? ''}
              rangos={semana[diaAbierto] ?? []}
              onCambiar={(rangos) => setDia(diaAbierto, rangos)}
              onCopiarATodos={() => copiarATodos(semana[diaAbierto] ?? [])}
              onCerrar={() => setDiaAbierto(null)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function EditorDia({
  dia,
  rangos,
  onCambiar,
  onCopiarATodos,
  onCerrar,
}: {
  dia: string
  rangos: RangoHorario[]
  onCambiar: (rangos: RangoHorario[]) => void
  onCopiarATodos: () => void
  onCerrar: () => void
}) {
  const cerrado = rangos.length === 0
  const incompleto = rangos.some((r) => !horaValida(r.desde) || !horaValida(r.hasta) || r.desde === r.hasta)

  return (
    <BottomSheet abierto onCerrar={onCerrar} titulo={`Horario del ${dia.toLowerCase()}`}>
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="dia-cerrado">Cerrado ese dia</Label>
          <Switch
            id="dia-cerrado"
            checked={cerrado}
            onCheckedChange={(v) => onCambiar(v ? [] : [{ desde: '12:00', hasta: '15:00' }])}
            aria-label="Cerrado ese dia"
          />
        </div>

        {!cerrado ? (
          <div className="space-y-3">
            {rangos.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`desde-${i}`}>Desde</Label>
                  <Input
                    id={`desde-${i}`}
                    type="time"
                    value={r.desde}
                    onChange={(e) => {
                      const copia = rangos.map((x, j) => (j === i ? { ...x, desde: e.target.value } : x))
                      onCambiar(copia)
                    }}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`hasta-${i}`}>Hasta</Label>
                  <Input
                    id={`hasta-${i}`}
                    type="time"
                    value={r.hasta}
                    onChange={(e) => {
                      const copia = rangos.map((x, j) => (j === i ? { ...x, hasta: e.target.value } : x))
                      onCambiar(copia)
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  aria-label={`Quitar franja ${i + 1}`}
                  onClick={() => onCambiar(rangos.filter((_, j) => j !== i))}
                >
                  Quitar
                </Button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => {
                const ultimo = rangos[rangos.length - 1]
                const desde = ultimo ? ultimo.hasta : '20:00'
                onCambiar([...rangos, { desde, hasta: '23:00' }])
              }}
            >
              + Agregar otra franja
            </Button>

            <p className="text-xs text-muted-foreground">
              Varias franjas por dia: ej. 12:00-15:00 y 20:00-23:00. Si &quot;hasta&quot; es menor que
              &quot;desde&quot; (20:00 a 02:00), la franja cruza la medianoche.
            </p>
            {incompleto ? (
              <p role="alert" className="text-xs text-destructive">
                Revisa las horas: hay una franja incompleta o con inicio y fin iguales.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ese dia el local no atiende.</p>
        )}

        {!cerrado ? (
          <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onCopiarATodos}>
            Copiar este horario a todos los dias
          </Button>
        ) : null}

        <Button type="button" className="min-h-12 w-full" onClick={onCerrar}>
          Listo
        </Button>
      </div>
    </BottomSheet>
  )
}
