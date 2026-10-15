'use client'

/**
 * MI PERFIL: el lugar donde el cliente ve, edita y BORRA los datos que declaró (cumpleaños y
 * genero), y donde puede pedir que no le pregunten mas.
 *
 * Es la cara visible del derecho de acceso + rectificacion + supresion (Ley 25.326): todo lo que
 * el cartel del perfilado puede guardar, aca se puede ver, cambiar y borrar en un tap. El borrado
 * es real y del lado del backend (`fechaNacimiento: null` / `genero: null` en el PATCH), y ademas
 * se limpia el rastro local del dispositivo.
 *
 * No inventa datos: si el backend todavia no expone los campos, se muestran como "sin cargar"
 * (no como un error) y la pantalla sigue siendo usable.
 */
import * as React from 'react'
import Link from 'next/link'
import { Button, Input, Label, RadioGroup, RadioGroupItem, Skeleton, Switch, buttonVariants } from '@repo/ui'
import { clientePerfilApi } from '@/lib/api'
import { RUTAS } from '@/lib/constants'
import { ETIQUETA_GENERO, GENEROS, limitesDeFechaNacimiento, validarFechaNacimiento } from '@/lib/perfilamiento-maquina'
import { limpiarPerfilamientoLocal } from '@/lib/perfilamiento-storage'
import { useBranding } from '@/hooks/useBranding'
import { useCliente } from '@/hooks/useCliente'
import type { Genero } from '@/types/api'

type Editando = 'cumple' | 'genero' | null
type Confirmando = 'cumple' | 'genero' | 'todo' | null

/** '3 de mayo de 1990'. En UTC a proposito: es una fecha de calendario (ver cumpleLegible). */
function fechaCompleta(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms))
}

export function PantallaPerfil({ slugNegocio }: { slugNegocio: string }) {
  const { negocio } = useBranding()
  const { cliente, autenticado, resuelto, refetch } = useCliente()

  const [editando, setEditando] = React.useState<Editando>(null)
  const [confirmando, setConfirmando] = React.useState<Confirmando>(null)
  const [guardando, setGuardando] = React.useState(false)
  const [aviso, setAviso] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Borradores del editor abierto.
  const [fecha, setFecha] = React.useState('')
  const [genero, setGenero] = React.useState<Genero | null>(null)
  const [errorFecha, setErrorFecha] = React.useState<string | null>(null)
  const limites = React.useMemo(() => limitesDeFechaNacimiento(), [])

  const nombreLocal = negocio?.nombre ?? 'el local'
  const cumple = fechaCompleta(cliente?.fechaNacimiento)
  const generoGuardado = cliente?.genero ?? null
  const rechazado = cliente?.perfiladoRechazado === true

  /**
   * Un solo camino para escribir: PATCH /auth/cliente/perfil. Lo que devuelve el backend es la
   * fuente de verdad; si contesta algo que no entendemos, se refresca con /me.
   */
  const enviar = React.useCallback(
    async (body: { fechaNacimiento?: string | null; genero?: Genero | null; rechazar?: boolean }, mensaje: string) => {
      setGuardando(true)
      setError(null)
      setAviso(null)
      try {
        await clientePerfilApi.guardar(body)
        await refetch()
        setAviso(mensaje)
        setEditando(null)
        setConfirmando(null)
      } catch {
        setError('No pudimos guardar el cambio. Probá de nuevo en un rato.')
      } finally {
        setGuardando(false)
      }
    },
    [refetch],
  )

  const borrarTodo = React.useCallback(async () => {
    // Se borra el rastro del dispositivo tambien: sin esto, el cooldown local quedaria huerfano.
    limpiarPerfilamientoLocal(slugNegocio)
    await enviar({ fechaNacimiento: null, genero: null }, 'Listo, borramos tus datos.')
  }, [enviar, slugNegocio])

  if (!resuelto) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!autenticado || !cliente) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">Todavía no tenés cuenta acá</h1>
        <p className="text-sm text-muted-foreground">
          Escaneá el QR en {nombreLocal} para sumar tu primera visita y crear tu tarjeta.
        </p>
        <Link href={RUTAS.club(slugNegocio)} className={buttonVariants({ className: 'min-h-12' })}>
          Ir al club
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Mis datos</h1>
        <p className="text-sm text-muted-foreground">
          Hola {cliente.nombre}. Estos datos son tuyos: podés cambiarlos o borrarlos cuando quieras.
          Los usa {nombreLocal} para saludarte el día de tu cumpleaños y para mandarte promos que te
          interesen.
        </p>
      </header>

      {aviso ? (
        <p role="status" className="rounded-2xl bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 ring-1 ring-emerald-400/40">
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
          {error}
        </p>
      ) : null}

      {/* --- Cumpleaños --- */}
      <section className="space-y-3 rounded-2xl bg-muted/40 p-4 ring-1 ring-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Cumpleaños</h2>
            <p className="text-sm text-muted-foreground">
              {cumple ?? 'Sin cargar'}
            </p>
          </div>
        </div>

        {editando === 'cumple' ? (
          <div className="space-y-3">
            <Label htmlFor="perfil-fecha-editor">Tu fecha de nacimiento</Label>
            <Input
              id="perfil-fecha-editor"
              type="date"
              autoComplete="bday"
              min={limites.min}
              max={limites.max}
              value={fecha}
              className="min-h-12 text-base"
              onChange={(e) => {
                setFecha(e.target.value)
                setErrorFecha(null)
              }}
              aria-invalid={Boolean(errorFecha)}
            />
            {errorFecha ? (
              <p role="alert" className="text-sm text-destructive">
                {errorFecha}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button
                className="min-h-12 w-full text-base"
                disabled={guardando}
                onClick={() => {
                  const r = validarFechaNacimiento(fecha)
                  if (!r.ok) {
                    setErrorFecha(r.error)
                    return
                  }
                  setErrorFecha(null)
                  void enviar({ fechaNacimiento: r.valor }, 'Guardamos tu cumpleaños.')
                }}
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
              <Button
                variant="ghost"
                className="min-h-12 w-full"
                disabled={guardando}
                onClick={() => {
                  setEditando(null)
                  setErrorFecha(null)
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : confirmando === 'cumple' ? (
          <ConfirmarBorrado
            que="tu cumpleaños"
            guardando={guardando}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={() => void enviar({ fechaNacimiento: null }, 'Borramos tu cumpleaños.')}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => {
                setEditando('cumple')
                setFecha(cliente.fechaNacimiento ? cliente.fechaNacimiento.slice(0, 10) : '')
              }}
            >
              {cumple ? 'Cambiar' : 'Agregar'}
            </Button>
            {cumple ? (
              <Button variant="ghost" className="min-h-12" onClick={() => setConfirmando('cumple')}>
                Borrar
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* --- Género --- */}
      <section className="space-y-3 rounded-2xl bg-muted/40 p-4 ring-1 ring-border">
        <div>
          <h2 className="text-base font-semibold">Cómo te identificás</h2>
          <p className="text-sm text-muted-foreground">
            {generoGuardado ? ETIQUETA_GENERO[generoGuardado] : 'Sin cargar'}
          </p>
        </div>

        {editando === 'genero' ? (
          <div className="space-y-3">
            <RadioGroup
              value={genero ?? ''}
              onValueChange={(v) => setGenero(v as Genero)}
              aria-label="Cómo te identificás"
            >
              {GENEROS.map((g) => (
                <div key={g} className="flex min-h-12 items-center gap-3">
                  <RadioGroupItem value={g} id={`perfil-editor-genero-${g}`} />
                  <Label htmlFor={`perfil-editor-genero-${g}`} className="cursor-pointer text-base font-normal">
                    {ETIQUETA_GENERO[g]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <div className="flex flex-col gap-2">
              <Button
                className="min-h-12 w-full text-base"
                disabled={guardando || !genero}
                onClick={() => {
                  if (genero) void enviar({ genero }, 'Guardamos cómo te identificás.')
                }}
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
              <Button
                variant="ghost"
                className="min-h-12 w-full"
                disabled={guardando}
                onClick={() => setEditando(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : confirmando === 'genero' ? (
          <ConfirmarBorrado
            que="cómo te identificás"
            guardando={guardando}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={() => void enviar({ genero: null }, 'Borramos ese dato.')}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => {
                setEditando('genero')
                setGenero(generoGuardado)
              }}
            >
              {generoGuardado ? 'Cambiar' : 'Agregar'}
            </Button>
            {generoGuardado ? (
              <Button variant="ghost" className="min-h-12" onClick={() => setConfirmando('genero')}>
                Borrar
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* --- Consentimiento / no molestar --- */}
      <section className="space-y-3 rounded-2xl bg-muted/40 p-4 ring-1 ring-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">No quiero que me pidan más datos</h2>
            <p className="text-xs text-muted-foreground">
              Si lo activás, no te volvemos a mostrar el cartel con la fecha de nacimiento ni con
              cómo te identificás. Lo que ya cargaste queda como está (lo podés borrar acá abajo).
            </p>
          </div>
          <Switch
            checked={rechazado}
            disabled={guardando}
            aria-label="No quiero que me pidan más datos"
            onCheckedChange={(v) =>
              void enviar(
                { rechazar: v === true },
                v === true ? 'Listo, no te volvemos a preguntar.' : 'Listo, te vamos a volver a preguntar.',
              )
            }
          />
        </div>
      </section>

      {/* --- Borrar todo / privacidad --- */}
      <section className="space-y-3 rounded-2xl bg-muted/40 p-4 ring-1 ring-border">
        <h2 className="text-base font-semibold">Tus datos y tu privacidad</h2>
        <p className="text-xs text-muted-foreground">
          Podés pedir el borrado completo de lo que declaraste. Tu tarjeta, tus sellos y tus visitas
          no se tocan: eso es el funcionamiento del club.
        </p>
        {confirmando === 'todo' ? (
          <ConfirmarBorrado
            que="todos tus datos de perfil"
            guardando={guardando}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={() => void borrarTodo()}
          />
        ) : (
          <Button variant="outline" className="min-h-12 w-full" onClick={() => setConfirmando('todo')}>
            Borrar todos mis datos de perfil
          </Button>
        )}
        {/* Link con area tactil de 48px (regla de la casa), no un texto suelto. */}
        <Link
          href={RUTAS.privacidad(slugNegocio)}
          className="flex min-h-12 items-center justify-center text-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Ver la política de privacidad
        </Link>
      </section>

      <Link href={RUTAS.tarjeta(slugNegocio)} className={buttonVariants({ variant: 'ghost', className: 'min-h-12' })}>
        Ver mi tarjeta
      </Link>
    </main>
  )
}

/** Borrado en dos pasos: nada se borra con un solo tap por accidente. */
function ConfirmarBorrado({
  que,
  guardando,
  onCancelar,
  onConfirmar,
}: {
  que: string
  guardando: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
      <p className="text-sm font-medium">¿Borramos {que}?</p>
      <p className="text-xs text-muted-foreground">No se puede deshacer, pero lo podés volver a cargar.</p>
      <div className="flex gap-2">
        <Button variant="destructive" className="min-h-12 flex-1" disabled={guardando} onClick={onConfirmar}>
          {guardando ? 'Borrando…' : 'Sí, borrar'}
        </Button>
        <Button variant="ghost" className="min-h-12 flex-1" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
