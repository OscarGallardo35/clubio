'use client'

/**
 * Aviso de "cerrado ahora". Informativo: el backend sigue bloqueando el POST /pedidos.
 * Se muestra SIN ocultar la carta (el cliente puede mirar el menu igual).
 */
import { cn } from '@repo/ui'

export interface AvisoCerradoProps {
  /** "hoy 12:00" / "manana 12:00". `null` si no se conoce la proxima apertura. */
  proximaTexto: string | null
  className?: string
}

export function AvisoCerrado({ proximaTexto, className }: AvisoCerradoProps) {
  const detalle = proximaTexto ? `abre ${proximaTexto}` : 'volve a intentarlo mas tarde'
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-0.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900',
        className,
      )}
    >
      <span className="font-medium">Cerrado ahora</span>
      <span className="text-xs">
        El local no esta tomando pedidos. {detalle.charAt(0).toUpperCase()}{detalle.slice(1)}.
      </span>
    </div>
  )
}
