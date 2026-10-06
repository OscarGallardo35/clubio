'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { Skeleton } from './skeleton'
import { buttonVariants } from './button'
import { cn } from '../lib/utils'

/**
 * Bloque de reseñas de Google (dentro del flujo del QR #2).
 *
 * PRESENTACIONAL a proposito: no hace fetch. El padre le pasa las reseñas y el
 * estado (cargando/error). Motivo: el fetch necesitaria @repo/api-client, que
 * necesita el tenant y la baseUrl configurados — eso vive en la app, no en el
 * package de UI. Asi el componente se testea sin mockear red.
 *
 * Se autoprotege: sin placeId no renderiza nada (ni un boton huerfano).
 */

export interface Resena {
  autorNombre: string
  autorFotoUrl?: string
  estrellas: number
  texto: string
  fechaResena: Date
}

export interface GoogleReviewsProps {
  placeId: string | null
  negocioNombre: string
  resenas?: Resena[]
  cargando?: boolean
  error?: string | null
  maxResenasAMostrar?: number
  estrellasMinimas?: number
  /** Si el backend ya calculo el promedio real (sobre TODAS las reseñas). */
  promedio?: number
  onDejarResena?: () => void
  onReintentar?: () => void
  reducedMotion?: boolean
  className?: string
}

const URL_RESENA = (placeId: string) =>
  `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`

/**
 * Antes de hidratar no se puede medir el DOM, asi que el overflow se estima por
 * longitud y despues ResizeObserver lo corrige. Sin esto, el boton "Ver más"
 * nunca aparece en el render de servidor.
 */
const LARGO_ESTIMADO_OVERFLOW = 180

function FilaEstrellas({ valor, tamano = 'sm' }: { valor: number; tamano?: 'sm' | 'md' }) {
  const llenas = Math.round(valor)
  const px = tamano === 'md' ? 'size-5' : 'size-4'
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${valor} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={cn(px, n <= llenas ? 'fill-warning-500 text-warning-500' : 'text-muted-foreground/40')}
        />
      ))}
    </span>
  )
}

/**
 * useLayoutEffect corre ANTES del paint (evita el flicker de SSR -> hidratacion
 * cuando el boton "Ver mas" aparece despues de medir), pero React avisa por
 * consola si corre en el servidor, donde no hay DOM. Este patron isomorfo usa
 * useEffect en el servidor y useLayoutEffect en el cliente: mismo orden de
 * hooks, sin warning y sin flicker.
 */
const useLayoutEffectIsomorfo =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

function TextoResena({ texto, reducedMotion }: { texto: string; reducedMotion: boolean }) {
  const [expandido, setExpandido] = React.useState(false)
  // Estimacion para el render de servidor: se corrige antes del primer paint.
  const [desborda, setDesborda] = React.useState(texto.length > LARGO_ESTIMADO_OVERFLOW)
  const ref = React.useRef<HTMLParagraphElement | null>(null)

  useLayoutEffectIsomorfo(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setDesborda(el.scrollHeight > el.clientHeight + 1)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [texto])

  const hayOverflow = desborda

  return (
    <div>
      <motion.div
        // `layout` anima el cambio de alto al expandir sin tener que calcularlo.
        layout={!reducedMotion}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      >
        <p
          ref={ref}
          className={cn('text-sm text-foreground/90', !expandido && 'line-clamp-3')}
        >
          {texto}
        </p>
      </motion.div>

      {hayOverflow ? (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          className="mt-1 text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          {expandido ? 'Ver menos' : 'Ver más'}
        </button>
      ) : null}
    </div>
  )
}

export function GoogleReviews({
  placeId,
  negocioNombre,
  resenas,
  cargando = false,
  error = null,
  maxResenasAMostrar = 3,
  estrellasMinimas = 4,
  promedio,
  onDejarResena,
  onReintentar,
  reducedMotion = false,
  className,
}: GoogleReviewsProps) {
  // Autoproteccion (refinamiento 2): sin placeId no hay a donde mandar al
  // usuario, asi que no se muestra ni el encabezado ni el boton.
  if (!placeId) return null

  const contenedor = (children: React.ReactNode) => (
    <section
      role="region"
      aria-label="Reseñas de Google"
      data-slot="google-reviews"
      className={cn('rounded-2xl border bg-card p-5', className)}
    >
      {children}
    </section>
  )

  const botonGoogle = (
    <a
      href={URL_RESENA(placeId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir Google Maps para dejar una reseña"
      onClick={() => onDejarResena?.()}
      className={cn(buttonVariants({ size: 'lg' }), 'mt-4 w-full')}
    >
      <Star aria-hidden="true" className="size-5" />
      Dejar reseña en Google
    </a>
  )

  if (cargando) {
    return contenedor(
      <div className="space-y-3" data-slot="google-reviews-skeleton">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>,
    )
  }

  if (error) {
    return contenedor(
      <div className="space-y-3 text-center" data-slot="google-reviews-error">
        <p className="text-base font-medium">No pudimos cargar las reseñas</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        {onReintentar ? (
          <button
            type="button"
            onClick={onReintentar}
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}
          >
            Reintentar
          </button>
        ) : null}
      </div>,
    )
  }

  const todas = resenas ?? []
  const promedioReal =
    promedio ??
    (todas.length
      ? Math.round((todas.reduce((acc, r) => acc + r.estrellas, 0) / todas.length) * 10) / 10
      : 0)

  // Sin reseñas todavía: invitacion directa.
  if (!todas.length) {
    return contenedor(
      <div className="space-y-2 text-center" data-slot="google-reviews-vacio">
        <p className="text-base font-semibold">
          Sé el primero en dejarnos una reseña
        </p>
        <p className="text-sm text-muted-foreground">
          Nos ayuda muchísimo a que más gente conozca {negocioNombre}.
        </p>
        {botonGoogle}
      </div>,
    )
  }

  const destacadas = todas
    .filter((r) => r.estrellas >= estrellasMinimas)
    .slice(0, maxResenasAMostrar)

  return contenedor(
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-base font-semibold">
          ¿Nos ayudás con una reseña en Google? Nos ayuda muchísimo.
        </p>
        <div className="flex items-center gap-2">
          <FilaEstrellas valor={promedioReal} tamano="md" />
          <span className="text-sm font-semibold">{promedioReal.toFixed(1)}</span>
          <span className="text-sm text-muted-foreground">
            ({todas.length} {todas.length === 1 ? 'reseña' : 'reseñas'})
          </span>
        </div>
      </header>

      <ul className="space-y-4" data-slot="google-reviews-lista">
        {destacadas.map((r, i) => (
          <li key={`${r.autorNombre}-${i}`} className="flex gap-3">
            {r.autorFotoUrl ? (
              // <img> y no next/image: este package no depende de next.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.autorFotoUrl}
                alt={r.autorNombre}
                width={40}
                height={40}
                loading="lazy"
                className="size-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
              >
                {r.autorNombre.slice(0, 1).toUpperCase()}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{r.autorNombre}</p>
                <time
                  dateTime={new Date(r.fechaResena).toISOString()}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {new Date(r.fechaResena).toLocaleDateString('es-AR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </time>
              </div>
              <FilaEstrellas valor={r.estrellas} />
              <div className="mt-1">
                <TextoResena texto={r.texto} reducedMotion={reducedMotion} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {botonGoogle}
    </div>,
  )
}

GoogleReviews.displayName = 'GoogleReviews'
