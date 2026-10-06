'use client'

/**
 * Imagen con placeholder, onError y transformaciones basicas de Cloudinary.
 *
 * Version SIMPLE a proposito: un `<img>` con `loading`/`decoding` y `object-cover`, mas el
 * aspect ratio en un contenedor para no mover el layout. El srcset con AVIF y los tamanos
 * responsivos son del Prompt #5.9.
 */
import * as React from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '../lib/utils'

export type TipoImagenOptimizada = 'item' | 'avatar' | 'logo' | 'categoria'

/** Ancho con el que se le pide la imagen a Cloudinary segun el uso. */
export const ANCHO_POR_TIPO: Record<TipoImagenOptimizada, number> = {
  item: 600,
  categoria: 320,
  logo: 240,
  avatar: 128,
}

/** Proporcion por defecto de cada tipo, para reservar el espacio (evita CLS). */
export const RATIO_POR_TIPO: Record<TipoImagenOptimizada, number> = {
  item: 4 / 3,
  categoria: 4 / 3,
  logo: 1,
  avatar: 1,
}

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

/**
 * Aplica las transformaciones basicas si la imagen es de Cloudinary.
 *
 * Solo cuando la URL NO trae ya una transformacion: si lo que sigue a `/upload/` empieza con
 * `v<digitos>/`, se asume que ya viene transformada y se deja igual. Asi no se pisan los
 * recortes que haya definido el negocio.
 */
export function urlOptimizada(src: string, tipo: TipoImagenOptimizada): string {
  const limpia = src.trim()
  if (!/res\.cloudinary\.com\//.test(limpia)) return limpia
  const partes = limpia.split('/upload/')
  const base = partes[0]
  const resto = partes[1]
  // Sin los chequeos de undefined, `noUncheckedIndexedAccess` no deja pasar `partes[1]` a test().
  if (partes.length !== 2 || base === undefined || resto === undefined) return limpia
  if (!/^v\d+\//.test(resto)) return limpia
  return `${base}/upload/c_fill,w_${ANCHO_POR_TIPO[tipo]},q_auto:good,f_auto/${resto}`
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
