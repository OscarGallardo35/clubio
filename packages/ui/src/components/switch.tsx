import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../lib/utils'

/**
 * Switch mobile-first (Radix).
 *
 * Mismo patron que el resto del sistema: forwardRef + ComponentPropsWithoutRef
 * + cn, y el area tactil ampliada a ~48px con `after:-inset-3` sin agrandar el
 * control visible (el riel mide 44x24).
 *
 * Radix mantiene sincronizado un `input[type=checkbox]` oculto, asi que el
 * control sigue siendo usable desde un formulario.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
      'after:absolute after:-inset-3 after:rounded-full',
      'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/40',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0',
        'transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
