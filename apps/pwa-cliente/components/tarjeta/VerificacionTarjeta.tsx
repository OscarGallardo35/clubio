'use client'

/**
 * Pagina PUBLICA de verificacion de la tarjeta (link del boton de WhatsApp del local).
 *
 * SIN login y SIN cookie: el token de la URL es la unica llave. Todo lo que se muestra
 * sale de GET /api/verificacion/:token (nombre de pila, negocio y la tarjeta con los
 * sellos reales). No usa BrandingProvider a proposito: esta fuera del layout del tenant
 * (no hay nav ni links a partes privadas) y el branding viaja en la propia respuesta.
 *
 * Token invalido/inexistente -> 404 amable, nunca un error crudo.
 */
import * as React from 'react'
import { useParams } from 'next/navigation'
import { getTheme } from '@repo/types'
import { Skeleton, TarjetaSellos } from '@repo/ui'
import { ApiError } from '@repo/api-client'
import { verificacionApi } from '@/lib/api'
import { COLOR_PRIMARIO_DEFECTO, COLOR_SECUNDARIO_DEFECTO } from '@/lib/constants'
import type { VerificacionRespuesta } from '@/types/api'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'ok'; data: VerificacionRespuesta }
  | { tipo: 'no-existe' }
  | { tipo: 'error' }

export function VerificacionTarjeta() {
  const params = useParams<{ token?: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'cargando' })

  React.useEffect(() => {
    if (!token) {
      setEstado({ tipo: 'no-existe' })
      return
    }
    let activo = true
    setEstado({ tipo: 'cargando' })
    verificacionApi
      .obtener(token)
      .then((data) => {
        if (activo) setEstado({ tipo: 'ok', data })
      })
      .catch((e) => {
        if (!activo) return
        // 404 = token invalido/inexistente. Cualquier otra cosa (red, 5xx) es un error distinto.
        setEstado(e instanceof ApiError && e.status === 404 ? { tipo: 'no-existe' } : { tipo: 'error' })
      })
    return () => {
      activo = false
    }
  }, [token])

  if (estado.tipo === 'cargando') return <Cargando />
  if (estado.tipo === 'no-existe') return <NoValido />
  if (estado.tipo === 'error') return <Fallo />

  return <Verificacion data={estado.data} />
}

function Verificacion({ data }: { data: VerificacionRespuesta }) {
  const theme = getTheme(data.negocio)
  const colorPrimario = data.negocio.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const colorSecundario = data.negocio.colorSecundario || COLOR_SECUNDARIO_DEFECTO

  // Fecha/hora local. Se formatea en el CLIENTE (la data llega despues del mount), asi que
  // no hay riesgo de mismatch de hidratacion.
  const fecha = new Date(data.verificadoEn).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className={`min-h-dvh w-full ${theme ? 'px-2' : 'px-4'} py-6`}
      style={{ background: `linear-gradient(160deg, ${colorPrimario}, ${colorSecundario})` }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5">
        <header className="text-center text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
            Verificación de tarjeta
          </p>
          <h1 className="mt-1 text-lg font-bold drop-shadow">{data.negocio.nombre}</h1>
        </header>

        <TarjetaSellos
          nombreCliente={data.nombre}
          nombreNegocio={data.negocio.nombre}
          logoUrl={data.negocio.logoUrl ?? undefined}
          tipo="VISITAS"
          actuales={data.sellos.actuales}
          meta={data.sellos.meta}
          premioTexto={data.premioTexto}
          colorPrimario={colorPrimario}
          colorSecundario={colorSecundario}
          tamaño="full"
          variante="glass"
          theme={theme}
          slugTenant={data.negocio.slug}
          // Solo lectura: sin animacion de ingreso ni ultima visita.
          reducedMotion
        />

        <section
          role="status"
          className={`w-full rounded-2xl p-4 text-center ring-1 ${
            data.sellos.premioDesbloqueado
              ? 'bg-emerald-500/20 ring-emerald-400/50'
              : 'bg-black/25 ring-white/20'
          } backdrop-blur`}
        >
          {data.sellos.premioDesbloqueado ? (
            <p className="text-base font-bold text-white drop-shadow">
              Premio desbloqueado: {data.premioTexto}
            </p>
          ) : (
            <p className="text-sm font-medium text-white/90">
              Todavía no llegó al premio{data.premioTexto ? ` (${data.premioTexto})` : ''}: {data.sellos.actuales} de{' '}
              {data.sellos.meta} sellos.
            </p>
          )}
        </section>

        <p className="flex items-center gap-2 text-center text-xs text-white/85">
          <span className="inline-flex size-2 rounded-full bg-emerald-400" aria-hidden="true" />
          Verificado el {fecha}
        </p>
      </div>
    </div>
  )
}

function Cargando() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/** 404 amable: mismo tono que el resto de la app, sin error tecnico. */
function NoValido() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Este enlace no es válido</h1>
      <p className="text-muted-foreground text-sm">
        No pudimos verificar esta tarjeta. Pedile al local que te comparta el enlace de nuevo.
      </p>
    </main>
  )
}

function Fallo() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">No pudimos verificar la tarjeta</h1>
      <p className="text-muted-foreground text-sm">Probá de nuevo en unos segundos.</p>
    </main>
  )
}
