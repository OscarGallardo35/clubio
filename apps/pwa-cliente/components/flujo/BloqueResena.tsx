'use client'

/**
 * Invitacion a dejar resena en Google.
 *
 * NO usa GoogleReviews todavia: ese componente muestra "Sé el primero en dejarnos
 * una reseña" cuando esta vacio, y la API de Google esta diferida. Sin los datos
 * reales, ese texto seria una afirmacion falsa. Cuando la API este, se reemplaza
 * por GoogleReviews con las reseñas de verdad.
 */
export interface BloqueResenaProps {
  placeId: string
  nombreNegocio: string
  onDejarResena?: (() => void) | undefined
}

export function BloqueResena({ placeId, nombreNegocio, onDejarResena }: BloqueResenaProps) {
  const url = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`

  return (
    <div className="w-full rounded-3xl bg-white/95 p-5 text-center shadow-xl">
      <p className="text-sm font-medium">¿Nos dejás una reseña?</p>
      <p className="mt-1 text-xs text-muted-foreground">Ayudás a que más gente conozca {nombreNegocio}.</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={onDejarResena}
        aria-label="Abrir Google Maps para dejar una reseña"
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold text-background"
      >
        Dejar mi reseña en Google
      </a>
    </div>
  )
}
