'use client'

import * as React from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import { cn } from '../lib/utils'

export type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * Toaster sobre sonner (ya era dependencia del package).
 * Por defecto abajo al centro: es donde llega el pulgar en el celular.
 */
function Toaster({ className, position = 'bottom-center', ...props }: ToasterProps) {
  return (
    <Sonner
      position={position}
      theme="system"
      richColors
      closeButton
      className={cn('toaster group', className)}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-2xl',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
