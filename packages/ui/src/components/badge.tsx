import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success-500 text-white',
        warning: 'border-transparent bg-warning-500 text-white',
        // Etiquetas de la carta (QR #1): vegano, sin-tacc, picante, nuevo.
        vegano: 'border-transparent bg-emerald-100 text-emerald-800',
        'sin-tacc': 'border-transparent bg-amber-100 text-amber-800',
        picante: 'border-transparent bg-red-100 text-red-800',
        nuevo: 'border-transparent bg-sky-100 text-sky-800',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
