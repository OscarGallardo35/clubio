'use client'

/**
 * Cartel NO INVASIVO que pide UN dato del perfil (cumpleaños o genero).
 *
 * Reusa `BottomSheet` de @repo/ui (el mismo que PremioAceptar): se cierra por swipe hacia abajo,
 * por tap afuera y por Escape — los tres caminos terminan en `onOmitir`, que es una omision (no
 * un rechazo): se anota el sello de tiempo y arranca el cooldown, pero el cliente puede volver a
 * responder desde Mi perfil cuando quiera.
 *
 * Es un componente de PRESENTACION: no sabe nada de red ni de localStorage. Quien decide si se
 * muestra y quien manda el PATCH es PerfilamientoGate.
 *
 * Reglas de la casa que se respetan aca:
 *  - Los textos salen de `textosDePerfil` (una sola fuente, testeable sin renderizar).
 *  - NO se promete ningun premio: el dueño configura los premios aparte.
 *  - Touch target minimo 48px (min-h-12) y `Guardar` deshabilitado hasta que haya consentimiento.
 *  - La fecha se valida ANTES de mandarla (no futura, no hace mas de 100 años).
 */
import * as React from 'react'
import { BottomSheet, Button, Checkbox, Input, Label, RadioGroup, RadioGroupItem } from '@repo/ui'
import {
  ETIQUETA_GENERO,
  GENEROS,
  limitesDeFechaNacimiento,
  textosDePerfil,
  validarFechaNacimiento,
} from '@/lib/perfilamiento-maquina'
import type { DatoPerfil } from '@/lib/perfilamiento-maquina'
import type { Genero } from '@/types/api'

export interface PedirDatoSheetProps {
  abierto: boolean
  dato: DatoPerfil
  nombreNegocio: string
  /** Mientras es true, los botones quedan bloqueados (evita el doble tap). */
  guardando?: boolean
  /** Error de red del PATCH; se muestra sin cerrar el cartel. */
  error?: string | null
  /** Link a la politica de privacidad del local (opcional). */
  hrefPrivacidad?: string | null
  onGuardar: (datos: { fechaNacimiento: string } | { genero: Genero }) => void
  onOmitir: () => void
}

export function PedirDatoSheet({
  abierto,
  dato,
  nombreNegocio,
  guardando = false,
  error = null,
  hrefPrivacidad = null,
  onGuardar,
  onOmitir,
}: PedirDatoSheetProps) {
  const textos = textosDePerfil(dato, nombreNegocio)
  const [consentimiento, setConsentimiento] = React.useState(false)
  const [fecha, setFecha] = React.useState('')
  const [genero, setGenero] = React.useState<Genero | null>(null)
  const [errorLocal, setErrorLocal] = React.useState<string | null>(null)

  // Los limites se recalculan al ABRIR (no en cada render): `max` tiene que ser el "hoy" de este
  // momento (si la pantalla quedo abierta toda la noche, el max viejo rechazaria el cumple de hoy)
  // pero estable mientras el picker nativo esta en uso.
  const [limites, setLimites] = React.useState(() => limitesDeFechaNacimiento())
  React.useEffect(() => {
    if (abierto) setLimites(limitesDeFechaNacimiento())
  }, [abierto, dato])

  // Cada apertura arranca limpia: el consentimiento no se hereda de una vez anterior.
  React.useEffect(() => {
    if (abierto) {
      setConsentimiento(false)
      setErrorLocal(null)
    }
  }, [abierto, dato])

  const enviar = () => {
    if (!consentimiento || guardando) return
    if (dato === 'cumple') {
      const r = validarFechaNacimiento(fecha)
      if (!r.ok) {
        setErrorLocal(r.error)
        return
      }
      setErrorLocal(null)
      onGuardar({ fechaNacimiento: r.valor })
      return
    }
    if (!genero) {
      setErrorLocal('Elegí una opción para poder guardarla.')
      return
    }
    setErrorLocal(null)
    onGuardar({ genero })
  }

  const puedeGuardar =
    consentimiento && (dato === 'cumple' ? fecha.length > 0 : genero !== null) && !guardando

  return (
    <BottomSheet
      abierto={abierto}
      altura="auto"
      onCerrar={onOmitir}
      titulo={textos.titulo}
    >
      <form
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
        noValidate
      >
        <p className="text-sm text-muted-foreground">{textos.ayuda}</p>

        {dato === 'cumple' ? (
          <div className="space-y-2">
            <Label htmlFor="perfil-fecha">Fecha de nacimiento</Label>
            <Input
              id="perfil-fecha"
              name="fechaNacimiento"
              type="date"
              inputMode="numeric"
              autoComplete="bday"
              min={limites.min}
              max={limites.max}
              value={fecha}
              className="min-h-12 text-base"
              onChange={(e) => {
                setFecha(e.target.value)
                setErrorLocal(null)
              }}
            />
          </div>
        ) : (
          <RadioGroup
            value={genero ?? ''}
            onValueChange={(v) => {
              setGenero(v as Genero)
              setErrorLocal(null)
            }}
            aria-label="Cómo te identificás"
          >
            {GENEROS.map((g) => (
              <div key={g} className="flex min-h-12 items-center gap-3">
                <RadioGroupItem value={g} id={`perfil-genero-${g}`} />
                <Label htmlFor={`perfil-genero-${g}`} className="cursor-pointer text-base font-normal">
                  {ETIQUETA_GENERO[g]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        {/* Consentimiento explicito: sin este tilde no se guarda nada. */}
        <div className="flex items-start gap-3 rounded-2xl bg-muted/50 p-3">
          <Checkbox
            id="perfil-consentimiento"
            checked={consentimiento}
            onCheckedChange={(v) => setConsentimiento(v === true)}
            aria-describedby="perfil-consentimiento-texto"
          />
          <Label
            htmlFor="perfil-consentimiento"
            id="perfil-consentimiento-texto"
            className="cursor-pointer text-sm font-normal leading-snug"
          >
            {textos.consentimiento}
          </Label>
        </div>

        {errorLocal || error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorLocal ?? error}
          </p>
        ) : null}

        {hrefPrivacidad ? (
          <a
            href={hrefPrivacidad}
            className="text-center text-xs text-muted-foreground underline underline-offset-4"
          >
            Cómo cuidamos tus datos
          </a>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={!puedeGuardar}>
            {guardando ? 'Guardando…' : textos.cta}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full text-base"
            onClick={onOmitir}
            disabled={guardando}
          >
            {textos.ahoraNo}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
