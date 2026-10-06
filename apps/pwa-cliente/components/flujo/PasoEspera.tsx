'use client'

import * as React from 'react'
import { Button, Separator } from '@repo/ui'
import { IconoReloj, IconoWhatsApp } from './iconos'
import type { EstadoWs } from '@/stores/visitaStore'

/** Texto del estado de conexion, en idioma del cliente y no del protocolo. */
const TEXTO_WS: Record<EstadoWs, string> = {
  conectado: 'Conectados con el local',
  conectando: 'Conectando con el local…',
  reconectando: 'Se cortó la conexión, reconectando…',
  desconectado: 'Sin conexión en vivo, consultando igual…',
  polling: 'Consultando el estado cada 5 segundos…',
}

function restante(expiraEn: string | null): string {
  if (!expiraEn) return ''
  const ms = new Date(expiraEn).getTime() - Date.now()
  if (ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface PasoEsperaProps {
  token: string
  expiraEn: string | null
  ws: EstadoWs
  numeroAtendiente?: string | null
  mensajeWhatsApp?: string | null
  onCancelar: () => void
}

/**
 * Se le muestra el codigo al personal. El contador refleja la vida real del
 * token (5 min en el backend), no una animacion decorativa.
 */
export function PasoEspera({ token, expiraEn, ws, numeroAtendiente, mensajeWhatsApp, onCancelar }: PasoEsperaProps) {
  const [resta, setResta] = React.useState(() => restante(expiraEn))

  React.useEffect(() => {
    setResta(restante(expiraEn))
    const id = setInterval(() => setResta(restante(expiraEn)), 1000)
    return () => clearInterval(id)
  }, [expiraEn])

  const wa = numeroAtendiente
    ? `https://wa.me/${numeroAtendiente.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeWhatsApp ?? 'Hola, quiero sumar mi visita')}`
    : null

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-white/15 text-white">
        <IconoReloj className="size-8" />
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-white drop-shadow">Mostrá este código al personal</h1>
        <p className="text-sm text-white/80">En cuanto lo aprueben, el sello se suma solo.</p>
      </header>

      <div className="w-full rounded-3xl bg-white/95 p-6 shadow-xl">
        <p className="font-mono text-2xl font-bold tracking-wider break-all text-foreground" aria-label="Código de visita">
          {token.slice(0, 8).toUpperCase()}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Código de tu visita</p>

        <Separator className="my-4" />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{TEXTO_WS[ws]}</span>
          <span className="font-medium tabular-nums">{resta}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {resta === '0:00'
            ? 'El código venció. Pedile al personal que genere uno nuevo.'
            : 'El código deja de servir cuando llega a 0:00.'}
        </p>
      </div>

      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white/95 px-5 text-sm font-semibold text-foreground shadow-lg"
        >
          <IconoWhatsApp className="size-5 text-emerald-600" />
          Avisarle al local por WhatsApp
        </a>
      )}

      <Button variant="ghost" className="min-h-12 text-white/90 hover:bg-white/10 hover:text-white" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  )
}
