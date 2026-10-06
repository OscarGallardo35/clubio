'use client'

/**
 * Imagen con placeholder, onError y transformaciones basicas de Cloudinary.
 *
 * Version SIMPLE a proposito: un `<img>` con `loading`/`decoding` y `object-cover`, mas el
 * aspect ratio en un contenedor para no mover el layout. El srcset con AVIF y los tamanos
 * responsivos son del Prompt #5.9.
 *
 * Los helpers (`urlOptimizada`, los anchos y los ratios) viven en `lib/url-optimizada.ts`,
 * que es puro y por eso se puede testear desde node sin arrastrar React.
 */
import * as React from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '../lib/utils'
import { RATIO_POR_TIPO, urlOptimizada } from '../lib/url-optimizada'
import type { TipoImagenOptimizada } from '../lib/url-optimizada'

export interface ImagenOptimizadaProps {
  src?: string | null | undefined
  /** Obligatorio: sin alt la imagen no dice nada a un lector de pantalla. */
  alt: string
  tipo?: TipoImagenOptimizada | undefined
  aspectRatio?: number | undefined
  /** true en las primeras cards visibles (baja el lazy loading de esas). */
  priority?: boolean | undefined
  className?: string | undefined
  fallbackIcon?: React.ReactNode | undefined
  /** Color del placeholder. Por defecto toma el primario de la marca. */
  placeholderColor?: string | undefined
}

/** En dev avisa por consola; en produccion es silencioso (mismo espiritu que _stub.tsx). */
function avisar(mensaje: string): void {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  if (p?.env?.NODE_ENV !== 'production') console.warn(`[@repo/ui] ${mensaje}`)
}

export function ImagenOptimizada({
  src,
  alt,
  tipo = 'item',
  aspectRatio,
  priority = false,
  className,
  fallbackIcon,
  placeholderColor,
}: ImagenOptimizadaProps) {
  const [fallo, setFallo] = React.useState(false)

  // Si cambia la url (por ejemplo al cambiar de sucursal), se reintenta.
  React.useEffect(() => {
    setFallo(false)
  }, [src])

  if (!alt || alt.trim() === '') avisar('<ImagenOptimizada> sin `alt`: hace falta para accesibilidad.')

  const url = src && src.trim() !== '' ? urlOptimizada(src, tipo) : null
  const ratio = aspectRatio ?? RATIO_POR_TIPO[tipo]
  const color = placeholderColor ?? 'var(--color-primary, #E63946)'

  return (
    <div
      className={cn('relative overflow-hidden bg-muted', className)}
      style={{ aspectRatio: String(ratio) }}
      data-estado={url && !fallo ? 'imagen' : 'placeholder'}
    >
      {url && !fallo ? (
        <img
          src={url}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFallo(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex h-full w-full items-center justify-center"
          style={{ backgroundColor: color }}
        >
          <span className="text-white/80" aria-hidden="true">
            {fallbackIcon ?? <ImageOff className="size-8" />}
          </span>
        </div>
      )}
    </div>
  )
}

// Reexport por compatibilidad: los helpers viven en lib/url-optimizada.ts.
export { ANCHO_POR_TIPO, RATIO_POR_TIPO, urlOptimizada } from '../lib/url-optimizada'
export type { TipoImagenOptimizada } from '../lib/url-optimizada'
