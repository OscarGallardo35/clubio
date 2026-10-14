'use client'

/**
 * VERIFICACION/CANJE de un premio que el cliente ACEPTO desde la notificacion.
 *
 * Es la "misma pagina de verificacion, adaptada": en vez de los sellos, el STAFF ve el
 * PREMIO, el negocio y el cliente (nombre de pila). El link lo arma el SERVIDOR
 * (`STAFF_APP_URL/<slug>/validar-premio?ref=<token>`) y le llega al local por WhatsApp
 * (mismo mecanismo del flujo de verificacion que ya existe, SIN imagen de QR).
 *
 * El staff marca CANJEADO desde staff.clubio.lat (requiere sesion: la ruta vive bajo el
 * grupo con login y el endpoint exige rol DUENO/ENCARGADO).
 */
import * as React from 'react'
import { Badge, Button, Skeleton } from '@repo/ui'
import { ApiError } from '@repo/api-client'
import { premiosApi } from '@/lib/api'
import type { PremioVerificacionRespuesta } from '@/types/api'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'ok'; data: PremioVerificacionRespuesta }
  | { tipo: 'no-existe' }
  | { tipo: 'error' }

export function PantallaValidarPremio({ tokenRef }: { tokenRef: string }) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'cargando' })
  const [canjeando, setCanjeando] = React.useState(false)
  const [aviso, setAviso] = React.useState<string | null>(null)

  const cargar = React.useCallback(() => {
    if (!tokenRef) {
      setEstado({ tipo: 'no-existe' })
      return
    }
    setEstado({ tipo: 'cargando' })
    premiosApi
      .verificacion(tokenRef)
      .then((data) => setEstado({ tipo: 'ok', data }))
      .catch((e) =>
        setEstado(e instanceof ApiError && e.status === 404 ? { tipo: 'no-existe' } : { tipo: 'error' }),
      )
  }, [tokenRef])

  React.useEffect(() => {
    cargar()
  }, [cargar])

  const canjear = async () => {
    if (canjeando) return
    setCanjeando(true)
    setAviso(null)
    try {
      const res = await premiosApi.canjear(tokenRef)
      setEstado({ tipo: 'ok', data: res })
      setAviso(res.yaCanjeado ? 'Este premio ya estaba canjeado.' : 'Premio marcado como canjeado.')
    } catch (e) {
      setAviso(
        e instanceof ApiError && e.status === 409
          ? 'El cliente todavía no aceptó el premio.'
          : 'No pudimos marcar el premio como canjeado.',
      )
    } finally {
      setCanjeando(false)
    }
  }

  if (estado.tipo === 'cargando') {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full" />
      </main>
    )
  }

  if (estado.tipo === 'no-existe') {
    return (
      <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold">Este premio no es válido</h1>
        <p className="text-muted-foreground text-sm">
          No encontramos el premio de este enlace. Pedile al cliente que te lo comparta de nuevo.
        </p>
      </main>
    )
  }

  if (estado.tipo === 'error') {
    return (
      <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold">No pudimos abrir el premio</h1>
        <p className="text-muted-foreground text-sm">Probá de nuevo en unos segundos.</p>
      </main>
    )
  }

  const p = estado.data
  const colorPrimario = p.negocio.colorPrimario || '#111111'
  const colorSecundario = p.negocio.colorSecundario || '#333333'

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Verificación de premio
        </p>
        <h1 className="mt-1 text-lg font-bold">{p.negocio.nombre}</h1>
        <p className="text-sm text-muted-foreground">Cliente: {p.cliente.nombre}</p>
      </header>

      <div
        className="rounded-3xl p-5 text-center text-white shadow-lg"
        style={{ background: `linear-gradient(160deg, ${colorPrimario}, ${colorSecundario})` }}
      >
        <div className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-white/20 text-3xl">
          🎁
        </div>
        <p className="text-lg font-bold drop-shadow">{p.texto}</p>
        <p className="mt-1 text-sm text-white/90">
          {p.tipo === 'SELLOS'
            ? `${p.cantidad} ${p.cantidad === 1 ? 'sello' : 'sellos'}`
            : p.tipo === 'PUNTOS'
              ? `${p.cantidad} ${p.cantidad === 1 ? 'punto' : 'puntos'}`
              : 'Premio libre (no mueve saldo)'}
        </p>
        {p.expiraLegible ? (
          <p className="mt-3 text-xs text-white/85">Válido hasta el {p.expiraLegible}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge variant={p.estado === 'CANJEADO' ? 'secondary' : 'default'}>{p.estado}</Badge>
        {p.campanaNombre ? <Badge variant="outline">Campaña</Badge> : null}
        {p.disparoNombre ? <Badge variant="outline">Disparo</Badge> : null}
      </div>

      {aviso ? (
        <p role="status" className="rounded-xl bg-muted/60 p-3 text-center text-sm">
          {aviso}
        </p>
      ) : null}

      {p.estado === 'ACEPTADO' && p.canjeable ? (
        <Button size="lg" className="w-full text-base" disabled={canjeando} onClick={canjear}>
          {canjeando ? 'Marcando…' : 'Marcar como canjeado'}
        </Button>
      ) : null}

      {p.estado === 'PENDIENTE' ? (
        <p className="text-center text-sm text-muted-foreground">
          El cliente todavía no aceptó este premio. Pedile que lo acepte desde la notificación.
        </p>
      ) : null}

      {p.estado === 'CANJEADO' ? (
        <p className="text-center text-sm font-medium text-emerald-600">
          {p.canjeadoEn
            ? `Canjeado el ${new Date(p.canjeadoEn).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : 'Premio canjeado.'}
        </p>
      ) : null}

      {p.estado === 'VENCIDO' ? (
        <p className="text-center text-sm text-muted-foreground">Este premio venció.</p>
      ) : null}
    </main>
  )
}
