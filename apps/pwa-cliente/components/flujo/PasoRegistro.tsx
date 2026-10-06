'use client'

import * as React from 'react'
import { registrarClienteSchema } from '@repo/validators'
import { Badge, Button, Input, Label, TarjetaSellos } from '@repo/ui'
import { IconoCheck } from './iconos'

/**
 * Primer paso: si no hay sesion se pide nombre + WhatsApp; si ya la hay, se
 * ofrece sumar la visita directo (quien ya es del club no se registra de nuevo).
 *
 * La validacion sale de @repo/validators: es la MISMA que usa la API. Se toma
 * solo la parte del formulario con .pick, porque negocioSlug y sucursalSlug los
 * agrega FlujoVisita.
 */
const esquema = registrarClienteSchema.pick({ nombre: true, telefono: true })

export interface PasoRegistroProps {
  nombreNegocio: string
  nombreCliente: string | null
  premioTexto: string
  meta: number
  actuales: number
  premioDesbloqueado: boolean
  logoUrl?: string | null
  colorPrimario: string
  colorSecundario: string
  autenticado: boolean
  cargando: boolean
  onRegistrar: (datos: { nombre: string; telefono: string }) => void
  onSumar: () => void
}

export function PasoRegistro({
  nombreNegocio,
  nombreCliente,
  premioTexto,
  meta,
  actuales,
  premioDesbloqueado,
  logoUrl,
  colorPrimario,
  colorSecundario,
  autenticado,
  cargando,
  onRegistrar,
  onSumar,
}: PasoRegistroProps) {
  const [nombre, setNombre] = React.useState('')
  const [telefono, setTelefono] = React.useState('')
  const [errores, setErrores] = React.useState<{ nombre?: string; telefono?: string }>({})

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const r = esquema.safeParse({ nombre, telefono })
    if (!r.success) {
      const campos: { nombre?: string; telefono?: string } = {}
      for (const issue of r.error.issues) {
        const campo = issue.path[0]
        if (campo === 'nombre' && !campos.nombre) campos.nombre = issue.message
        if (campo === 'telefono' && !campos.telefono) campos.telefono = issue.message
      }
      setErrores(campos)
      return
    }
    setErrores({})
    onRegistrar(r.data)
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-white drop-shadow">{nombreNegocio}</h1>
        <p className="text-sm text-white/80">Sumá tu visita y ganá premios</p>
      </header>

      <TarjetaSellos
        tamaño="small"
        nombreNegocio={nombreNegocio}
        logoUrl={logoUrl ?? undefined}
        nombreCliente={nombreCliente ?? undefined}
        tipo="VISITAS"
        actuales={actuales}
        meta={meta}
        premioTexto={premioTexto}
        colorPrimario={colorPrimario}
        colorSecundario={colorSecundario}
        estado={premioDesbloqueado ? 'completa' : undefined}
      />

      {autenticado ? (
        <div className="w-full space-y-3 rounded-3xl bg-white/95 p-5 text-center shadow-xl">
          <p className="text-sm text-muted-foreground">
            {nombreCliente ? `Hola de nuevo, ${nombreCliente}` : 'Ya sos parte del club'}
          </p>
          <Button size="lg" className="min-h-12 w-full text-base" onClick={onSumar} disabled={cargando}>
            {cargando ? 'Sumando…' : 'Sumar mi visita'}
          </Button>
        </div>
      ) : (
        <form onSubmit={enviar} className="w-full space-y-4 rounded-3xl bg-white/95 p-5 shadow-xl" noValidate>
          <div className="space-y-2">
            <Label htmlFor="nombre">Tu nombre</Label>
            <Input
              id="nombre"
              name="nombre"
              autoComplete="given-name"
              className="min-h-12 text-base"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cómo te llamás"
              aria-invalid={Boolean(errores.nombre)}
              aria-describedby={errores.nombre ? 'error-nombre' : undefined}
            />
            {errores.nombre && (
              <p id="error-nombre" role="alert" className="text-sm text-destructive">
                {errores.nombre}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefono">Tu WhatsApp</Label>
            <Input
              id="telefono"
              name="telefono"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="min-h-12 text-base"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+5491123456789"
              aria-invalid={Boolean(errores.telefono)}
              aria-describedby={errores.telefono ? 'error-telefono' : 'ayuda-telefono'}
            />
            {errores.telefono ? (
              <p id="error-telefono" role="alert" className="text-sm text-destructive">
                {errores.telefono}
              </p>
            ) : (
              <p id="ayuda-telefono" className="text-xs text-muted-foreground">
                Con código de país, sin espacios.
              </p>
            )}
          </div>

          <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={cargando}>
            {cargando ? 'Entrando…' : 'Sumar mi visita'}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <IconoCheck className="size-3.5" />
            Usamos tu número solo para el club del local.
          </p>
        </form>
      )}

      <Badge variant="secondary" className="bg-white/15 text-white">
        {meta} sellos = {premioTexto}
      </Badge>
    </div>
  )
}
