'use client'

import * as React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { BottomSheet } from './bottom-sheet'
import { Button } from './button'
import { cn } from '../lib/utils'
import {
  CLAVE_DESCARTE_PWA,
  usePWAInstall,
  type NavegadorInApp,
} from '../hooks/use-pwa-install'

/**
 * Banner de instalacion GUIADA de la PWA.
 *
 * Aparece SOLO si la app no esta instalada, no fue descartada (30 dias de cool-off en
 * localStorage) y la deteccion ya corrio. Se ramifica por dispositivo:
 *  - navegador in-app (Instagram/Facebook/TikTok/LinkedIn): no se puede instalar desde adentro ->
 *    se pide abrir en Safari/Chrome y se ofrece copiar el link.
 *  - iOS: no hay prompt automatico -> instrucciones paso a paso en un BottomSheet.
 *  - Android: boton que dispara el `beforeinstallprompt` capturado (o instrucciones si no hay).
 *  - escritorio: QR para escanear con el celular.
 *
 * Los iconos se dibujan inline (SVG con `currentColor`) y NO con lucide-react: las PWAs no
 * dependen de esa libreria (mismo criterio que BottomNav / _iconos.tsx).
 *
 * Todo el markup es `w-full` / `min-w-0` sin anchos fijos: el repo acaba de arreglar un desborde
 * horizontal real y el banner no puede reintroducirlo a 375px.
 */

type IconoProps = { className?: string | undefined }

const SVG_BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconoInstalar({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  )
}

function IconoCerrar({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function IconoCompartir({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

function IconoSafari({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 5-5 2.2 2.2-5z" />
    </svg>
  )
}

function IconoAgregarInicio({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function IconoCheck({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconoNavegador({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  )
}

function IconoMenuPuntos({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} strokeWidth={0} className={className}>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  )
}

function IconoCopiar({ className }: IconoProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** Un paso de las instrucciones manuales: icono dibujado + texto. */
interface Paso {
  Icono: (p: IconoProps) => JSX.Element
  texto: string
}

const PASOS_IOS: Paso[] = [
  { Icono: IconoSafari, texto: 'Abri esta pagina en Safari (si todavia no estas ahi).' },
  { Icono: IconoCompartir, texto: 'Toca el boton Compartir (el cuadradito con la flecha, abajo).' },
  { Icono: IconoAgregarInicio, texto: 'Elegi "Agregar a pantalla de inicio" en el menu.' },
  { Icono: IconoCheck, texto: 'Toca "Agregar". Listo: la app queda con su icono en el inicio.' },
]

const PASOS_ANDROID: Paso[] = [
  { Icono: IconoNavegador, texto: 'Abri esta pagina en Chrome (si todavia no estas ahi).' },
  { Icono: IconoMenuPuntos, texto: 'Toca el menu de tres puntos (arriba a la derecha).' },
  { Icono: IconoAgregarInicio, texto: 'Elegi "Instalar app" o "Agregar a pantalla de inicio".' },
  { Icono: IconoCheck, texto: 'Confirma "Instalar". Listo: la app queda en tu inicio.' },
]

export interface BannerInstalacionProps {
  className?: string | undefined
  /** Clave de localStorage del descarte. Default: la compartida por el origen. */
  claveDescarte?: string | undefined
  /** Nombre visible de la app en los textos ("Clubio", "Clubio Staff", "Clubio Admin"). */
  nombreApp?: string | undefined
}

export function BannerInstalacion({
  className,
  claveDescarte = CLAVE_DESCARTE_PWA,
  nombreApp = 'Clubio',
}: BannerInstalacionProps) {
  const pwa = usePWAInstall(claveDescarte)
  const [pasosAbiertos, setPasosAbiertos] = React.useState(false)
  const [copiado, setCopiado] = React.useState(false)
  const urlInstall = typeof window !== 'undefined' ? window.location.origin : ''

  const copiarLink = React.useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopiado(true)
    } catch {
      // Clipboard bloqueado (p.ej. sin permisos): se deja el link visible para copiar a mano.
      setCopiado(false)
    }
  }, [])

  // Reset del feedback de copiado.
  React.useEffect(() => {
    if (!copiado) return
    const t = window.setTimeout(() => setCopiado(false), 2500)
    return () => window.clearTimeout(t)
  }, [copiado])

  if (!pwa.visible) return null

  const inApp = pwa.navegadorInApp
  const mostrarQr = pwa.esEscritorio && !inApp

  return (
    <>
      <section
        aria-label={`Instalar ${nombreApp}`}
        data-banner-instalacion=""
        className={cn(
          'w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm',
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
            <IconoInstalar className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{tituloBanner({ pwa, inApp, nombreApp })}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{textoBanner({ pwa, inApp, nombreApp })}</p>
          </div>
          <button
            type="button"
            onClick={pwa.descartar}
            aria-label="No mostrar de nuevo por 30 dias"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          >
            <IconoCerrar className="h-4 w-4" />
          </button>
        </div>

        {inApp ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button size="sm" className="w-full sm:w-auto" onClick={() => void copiarLink()}>
              <IconoCopiar className="h-4 w-4" />
              {copiado ? 'Link copiado' : 'Copiar link'}
            </Button>
          </div>
        ) : null}

        {pwa.esIOS && !inApp ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button size="sm" className="w-full sm:w-auto" onClick={() => setPasosAbiertos(true)}>
              Ver como instalarla
            </Button>
          </div>
        ) : null}

        {pwa.esAndroid && !inApp ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {pwa.tienePromptNativo ? (
              <Button size="sm" className="w-full sm:w-auto" onClick={() => void pwa.instalar()}>
                Instalar app
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setPasosAbiertos(true)}>
                Ver como instalarla
              </Button>
            )}
          </div>
        ) : null}

        {mostrarQr ? (
          <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="rounded-xl bg-white p-2" data-qr-instalacion="">
              <QRCodeSVG value={urlInstall} size={132} level="M" marginSize={0} bgColor="#FFFFFF" fgColor="#111827" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-all text-xs text-muted-foreground">{urlInstall}</p>
              <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void copiarLink()}>
                <IconoCopiar className="h-4 w-4" />
                {copiado ? 'Link copiado' : 'Copiar link'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <BottomSheet
        abierto={pasosAbiertos}
        onCerrar={() => setPasosAbiertos(false)}
        titulo={pwa.esIOS ? `Instalar en ${pwa.esIPad ? 'iPad' : 'iPhone'}` : 'Instalar en Android'}
      >
        <ol className="space-y-4 py-1">
          {(pwa.esIOS ? PASOS_IOS : PASOS_ANDROID).map((paso, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <paso.Icono className="h-5 w-5" />
              </span>
              <p className="min-w-0 flex-1 pt-1 text-sm">{paso.texto}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Cuando termines, {nombreApp} va a abrir a pantalla completa, como cualquier app.
        </p>
      </BottomSheet>
    </>
  )
}

function tituloBanner({
  pwa,
  inApp,
  nombreApp,
}: {
  pwa: ReturnType<typeof usePWAInstall>
  inApp: NavegadorInApp
  nombreApp: string
}): string {
  if (inApp) return `Abrí ${nombreApp} en ${pwa.abrirEn}`
  if (pwa.esIOS) return `Instalá ${nombreApp} en tu ${pwa.esIPad ? 'iPad' : 'iPhone'}`
  if (pwa.esAndroid) return `Instalá ${nombreApp} en tu celular`
  return `Instalá ${nombreApp} en tu celular`
}

function textoBanner({
  pwa,
  inApp,
  nombreApp,
}: {
  pwa: ReturnType<typeof usePWAInstall>
  inApp: NavegadorInApp
  nombreApp: string
}): string {
  if (inApp) return `Estás en el navegador de ${inApp}, que no permite instalar apps. Abrí el link en ${pwa.abrirEn}.`
  if (pwa.esIOS) return 'Agregala a la pantalla de inicio para abrirla con un toque y a pantalla completa.'
  if (pwa.esAndroid) return 'Instalala y accedé más rápido desde el ícono, sin pasar por el navegador.'
  return `Escaneá el QR con la cámara del teléfono para instalar ${nombreApp}.`
}
