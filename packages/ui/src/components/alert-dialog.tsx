'use client'

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '../lib/utils'
import { buttonVariants } from './button'

/**
 * AlertDialog (Radix).
 *
 * La diferencia con `Dialog` no es cosmetica: un AlertDialog **no se cierra** con Escape ni
 * con click afuera, y el foco arranca en el boton de cancelar. Es para confirmaciones
 * destructivas (borrar un empleado, dar de baja una sucursal), donde "lo cerre sin querer" no
 * puede ser una salida valida.
 *
 * `AlertDialogAction` y `AlertDialogCancel` son botones con las variantes del `Button`: el
 * proyecto exporta `buttonVariants()` justamente para no necesitar `asChild` (que viene de
 * `@radix-ui/react-slot`, que no esta instalado).
 */
const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, onEscapeKeyDown, ...props }, ref) => (
  <AlertDialogPrimitive.Portal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      // El comentario de arriba tiene que ser CIERTO, no una intencion: verificado en runtime, el
      // AlertDialog de Radix SI cierra con Escape (el click afuera ya lo bloquea el solo). Para una
      // confirmacion destructiva "lo cerre sin querer" no puede ser una salida valida: la unica
      // salida es un boton (y el foco arranca en Cancelar).
      onEscapeKeyDown={(evento: KeyboardEvent) => {
        evento.preventDefault();
        onEscapeKeyDown?.(evento);
      }}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
        'rounded-2xl border bg-background p-6 shadow-lg',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  </AlertDialogPrimitive.Portal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // Accion arriba en mobile (al pulgar) y a la derecha en desktop: mobile-first.
  <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn('text-xl font-semibold', className)} {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), 'mt-0 sm:mt-0', className)}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
