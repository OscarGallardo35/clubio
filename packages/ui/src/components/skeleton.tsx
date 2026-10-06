import * as React from 'react'
import { cn } from '../lib/utils'

/**
 * Placeholder de carga. Se usa SIEMPRE con un contenedor de aspect-ratio o
 * altura fija: si no, el skeleton no reserva el espacio y el contenido salta
 * (CLS) cuando llega la data real.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-xl bg-muted', className)} {...props} />
}

export { Skeleton }
