'use client'

/**
 * Acceso flotante al carrito.
 *
 * Se oculta cuando el CarritoSheet esta abierto (para no duplicar la entrada) y cuando el carrito
 * esta vacio. El `bottom` incluye el safe-area de iOS: sin eso queda tapado por la barra del
 * sistema en el celular.
 */
import { formatearPrecio } from '@repo/utils'
import { seleccionarTotal, useCarritoStore } from '@/stores/carritoStore'
import { ALTO_NAV_REM } from '@/lib/nav-tabs'

export interface BadgeCarritoProps {
  onClick: () => void
  /** true cuando el sheet esta abierto. */
  oculto?: boolean | undefined
}

export function BadgeCarrito({ onClick, oculto }: BadgeCarritoProps) {
  const items = useCarritoStore((s) => s.items)
  const total = useCarritoStore(seleccionarTotal)

  if (oculto || items.length === 0) return null

  const cantidad = items.reduce((acc, i) => acc + i.cantidad, 0)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver el carrito: ${cantidad} ${cantidad === 1 ? 'item' : 'items'}, ${formatearPrecio(total)}`}
      className="fixed right-4 z-50 flex min-h-12 items-center gap-3 rounded-full px-5 shadow-lg transition active:scale-95"
      style={{
        // Arriba del BottomNav (z-40) para no quedar tapado, y con el safe-area de iOS.
        bottom: `calc(env(safe-area-inset-bottom) + ${ALTO_NAV_REM}rem + 1rem)`,
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
      }}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-black/20 text-xs font-semibold tabular-nums">
        {cantidad}
      </span>
      <span className="font-medium">{formatearPrecio(total)}</span>
    </button>
  )
}
