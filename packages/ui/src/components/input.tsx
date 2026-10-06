import * as React from 'react'
import { cn } from '../lib/utils'

export interface InputProps extends React.ComponentProps<'input'> {}

/**
 * Input mobile-first: 56px de alto (h-14) y 16px de fuente, que es el minimo
 * para que iOS no haga zoom automatico al enfocar.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? 'text'}
      className={cn(
        'flex h-14 w-full rounded-xl border border-input bg-background px-4 py-2 text-base',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
