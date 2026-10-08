/**
 * Iconos internos de @repo/ui (no se exportan desde el indice).
 *
 * Se dibujan a mano en vez de usar `lucide-react` (que es dependencia del package) porque los
 * componentes ya existentes — `Checkbox`, el boton de cerrar del `Dialog` — usan SVG inline con
 * `currentColor`, y asi el icono hereda el color del contexto sin props de por medio.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function IconoChevronAbajo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconoChevronArriba({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

export function IconoChevronDerecha({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function IconoCheck({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} strokeWidth={3} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function IconoPunto({ className = 'h-2.5 w-2.5' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </svg>
  )
}
