import * as React from 'react'
import { cn } from '../lib/utils'

export interface TextareaProps extends React.ComponentProps<'textarea'> {}

/**
 * Textarea con el mismo alto de fuente que Input (16px): por debajo de eso iOS
 * hace zoom automatico al enfocar. Crece hacia abajo (resize-y) porque el
 * ancho ya lo maneja el layout.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-28 w-full resize-y rounded-xl border border-input bg-background px-4 py-3 text-base',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
