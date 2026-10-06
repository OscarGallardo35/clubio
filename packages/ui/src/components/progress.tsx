import * as React from 'react'
import { cn } from '../lib/utils'

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100. Se recorta fuera de rango en vez de confiar en el llamador. */
  value?: number
  /** Clase del riel interno (permite gradientes por negocio). */
  indicatorClassName?: string
  /** Desactiva la transicion (lo usa TarjetaSellos con reduced motion). */
  sinTransicion?: boolean
}

/**
 * Hecho a mano a proposito: el Progress de shadcn necesita
 * @radix-ui/react-progress, que no esta instalado, y para un div con un ancho
 * porcentual no vale la pena sumar una dependencia.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, sinTransicion, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
        {...props}
      >
        <div
          data-slot="progress-indicator"
          className={cn(
            'h-full w-full flex-1 rounded-full bg-primary',
            !sinTransicion && 'transition-[width] duration-500 ease-out',
            indicatorClassName,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  },
)
Progress.displayName = 'Progress'

export { Progress }
