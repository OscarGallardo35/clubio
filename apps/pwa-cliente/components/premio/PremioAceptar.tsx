'use client'

/**
 * Modal de ACEPTAR un premio que llego por push (`/<slug>/premio/<token>`).
 *
 * Vive DENTRO del grupo `[tenant]` a proposito: hereda `BrandingProvider` y el
 * BottomNav del local (colores y logo del tenant). La modal es un `BottomSheet` que
 * se abre por encima.
 *
 * SIN login: el TOKEN de la URL es la unica llave (igual que la verificacion publica).
 * Se muestra el premio, el negocio, el vencimiento y el CTA "Aceptar premio". Al
 * aceptar, el backend acredita el saldo UNA sola vez (claim atomico) y devuelve el
 * link de verificacion + el boton de WhatsApp al numero de atencion del local
 * (el MISMO flujo del sistema de verificacion que ya existe, sin imagen de QR).
 *
 * Estados que NUNCA rompen: vencido, ya aceptado y ya canjeado muestran mensajes amables.
 */
import * as React from 'react'
import { useParams } from 'next/navigation'
import { BottomSheet, Button, buttonVariants, Skeleton } from '@repo/ui'
import { ApiError } from '@repo/api-client'
import { premiosApi } from '@/lib/api'
import { COLOR_PRIMARIO_DEFECTO, COLOR_SECUNDARIO_DEFECTO } from '@/lib/constants'
import type { PremioAceptarRespuesta, PremioPublico } from '@/types/api'

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'ok'; data: PremioPublico }
  | { tipo: 'no-existe' }
  | { tipo: 'error' }

export function PremioAceptar() {
  const params = useParams<{ token?: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'cargando' })
  const [aceptando, setAceptando] = React.useState(false)
  const [aceptado, setAceptado] = React.useState<PremioAceptarRespuesta | null>(null)

  const cargar = React.useCallback(() => {
    if (!token) {
      setEstado({ tipo: 'no-existe' })
      return
    }
    setEstado({ tipo: 'cargando' })
    premiosApi
      .obtener(token)
      .then((data) => setEstado({ tipo: 'ok', data }))
      .catch((e) => {
        setEstado(e instanceof ApiError && e.status === 404 ? { tipo: 'no-existe' } : { tipo: 'error' })
      })
  }, [token])

  React.useEffect(() => {
    cargar()
  }, [cargar])

  const aceptar = async () => {
    if (!token || aceptando) return
    setAceptando(true)
    try {
      const res = await premiosApi.aceptar(token)
      setAceptado(res)
      // Refresca el estado mostrado (pasa a ACEPTADO/CANJEADO).
      premiosApi
        .obtener(token)
        .then((data) => setEstado({ tipo: 'ok', data }))
        .catch(() => undefined)
    } catch {
      setEstado({ tipo: 'error' })
    } finally {
      setAceptando(false)
    }
  }

  return (
    <div className="min-h-dvh w-full bg-background" aria-hidden={estado.tipo !== 'ok' || !!aceptado}>
      {estado.tipo === 'cargando' ? (
        <div className="mx-auto w-full max-w-md p-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : null}
      {estado.tipo === 'no-existe' ? <NoValido /> : null}
      {estado.tipo === 'error' ? <Fallo /> : null}

      {estado.tipo === 'ok' ? (
        <BottomSheet
          abierto
          altura="auto"
          mostrarDragHandle={false}
          cerrarAlClickFuera={false}
          cerrarAlSwipeDown={false}
          onCerrar={() => undefined}
          titulo="Tu premio"
        >
          <Contenido
            premio={estado.data}
            aceptado={aceptado}
            aceptando={aceptando}
            onAceptar={aceptar}
          />
        </BottomSheet>
      ) : null}
    </div>
  )
}

function Contenido({
  premio,
  aceptado,
  aceptando,
  onAceptar,
}: {
  premio: PremioPublico
  aceptado: PremioAceptarRespuesta | null
  aceptando: boolean
  onAceptar: () => void
}) {
  const colorPrimario = premio.negocio.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const colorSecundario = premio.negocio.colorSecundario || COLOR_SECUNDARIO_DEFECTO
  const estado = aceptado?.estado ?? premio.estado
  const vencimiento = premio.expiraLegible

  const esLibre = premio.tipo === 'LIBRE'
  const etiquetaPremio =
    premio.tipo === 'SELLOS'
      ? `${premio.cantidad} ${premio.cantidad === 1 ? 'sello' : 'sellos'}`
      : premio.tipo === 'PUNTOS'
        ? `${premio.cantidad} ${premio.cantidad === 1 ? 'punto' : 'puntos'}`
        : null

  return (
    <div className="flex flex-col gap-4 pb-1">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {premio.negocio.nombre}
        </p>
      </div>

      {/* Tarjeta del premio con los colores del local. */}
      <div
        className="rounded-3xl p-5 text-center text-white shadow-lg"
        style={{ background: `linear-gradient(160deg, ${colorPrimario}, ${colorSecundario})` }}
      >
        <div className="mx-auto mb-2 flex size-16 items-center justify-center rounded-full bg-white/20 text-3xl">
          🎁
        </div>
        <p className="text-lg font-bold drop-shadow">{premio.texto}</p>
        {etiquetaPremio ? (
          <p className="mt-1 text-sm text-white/90">{etiquetaPremio} para tu tarjeta</p>
        ) : (
          <p className="mt-1 text-sm text-white/90">Mostralo en el local para canjearlo</p>
        )}
        {vencimiento ? (
          <p className="mt-3 text-xs text-white/85">
            {estado === 'VENCIDO' ? 'Venció el ' : 'Válido hasta el '}
            {vencimiento}
          </p>
        ) : null}
      </div>

      {estado === 'PENDIENTE' && !aceptado ? (
        <Button size="lg" className="w-full text-base" disabled={aceptando} onClick={onAceptar}>
          {aceptando ? 'Aceptando…' : 'Aceptar premio'}
        </Button>
      ) : null}

      {estado === 'VENCIDO' ? (
        <Mensaje
          titulo="Este premio venció"
          texto="Pasó la fecha de validez y ya no se puede aceptar. ¡Seguí sumando para el próximo!"
        />
      ) : null}

      {aceptado || estado === 'ACEPTADO' || estado === 'CANJEADO' ? (
        <PanelCanje premio={premio} aceptado={aceptado} estado={estado} esLibre={esLibre} />
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        {estado === 'PENDIENTE' ? 'Al aceptarlo, se acredita una sola vez.' : ''}
      </p>
    </div>
  )
}

/** Tras aceptar: el MISMO mecanismo de verificacion (link del servidor + WhatsApp al local). */
function PanelCanje({
  premio,
  aceptado,
  estado,
  esLibre,
}: {
  premio: PremioPublico
  aceptado: PremioAceptarRespuesta | null
  estado: string
  esLibre: boolean
}) {
  const ver = aceptado?.verificacion ?? null

  if (estado === 'CANJEADO') {
    return (
      <Mensaje
        titulo="¡Premio canjeado!"
        texto="El local ya verificó y canjeó tu premio. ¡Que lo disfrutes!"
        tono="ok"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4 ring-1 ring-border">
      <p className="text-sm font-semibold">Mostralo en el local para canjearlo</p>
      <p className="text-xs text-muted-foreground">
        {esLibre
          ? 'El local verifica el premio y lo marca como canjeado.'
          : 'Tu saldo ya quedó acreditado. El local verifica el premio y lo marca como canjeado.'}
      </p>
      {ver?.whatsapp ? (
        <a
          href={ver.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: 'lg' }) + ' w-full text-base'}
        >
          Avisar al local por WhatsApp
        </a>
      ) : null}
      {ver?.url ? (
        <a
          href={ver.url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-center text-xs text-muted-foreground underline"
        >
          Abrir verificación del premio
        </a>
      ) : null}
      {aceptado && (aceptado.acreditado.sellos > 0 || aceptado.acreditado.puntos > 0) ? (
        <p className="text-center text-xs font-medium text-emerald-600">
          {aceptado.acreditado.sellos > 0
            ? `+${aceptado.acreditado.sellos} ${aceptado.acreditado.sellos === 1 ? 'sello' : 'sellos'} `
            : ''}
          {aceptado.acreditado.puntos > 0
            ? `+${aceptado.acreditado.puntos} ${aceptado.acreditado.puntos === 1 ? 'punto' : 'puntos'}`
            : ''}
          acreditado en tu tarjeta
        </p>
      ) : null}
      {premio.disparoNombre || premio.campanaNombre ? (
        <p className="text-center text-[11px] text-muted-foreground">
          {premio.campanaNombre ? `Campaña: ${premio.campanaNombre}` : `Premio: ${premio.disparoNombre}`}
        </p>
      ) : null}
    </div>
  )
}

function Mensaje({ titulo, texto, tono }: { titulo: string; texto: string; tono?: 'ok' }) {
  return (
    <div
      role="status"
      className={`rounded-2xl p-4 text-center ring-1 ${
        tono === 'ok' ? 'bg-emerald-500/10 ring-emerald-400/40' : 'bg-muted/50 ring-border'
      }`}
    >
      <p className="text-base font-bold">{titulo}</p>
      <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
    </div>
  )
}

/** 404 amable: mismo tono que el resto de la app. */
function NoValido() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Este premio no es válido</h1>
      <p className="text-muted-foreground text-sm">
        No pudimos encontrar el premio de este enlace. Pedile al local que te lo comparta de nuevo.
      </p>
    </main>
  )
}

function Fallo() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">No pudimos abrir el premio</h1>
      <p className="text-muted-foreground text-sm">Probá de nuevo en unos segundos.</p>
    </main>
  )
}
