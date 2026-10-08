'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from '../lib/utils'
import { IconoCheck, IconoChevronAbajo } from './_iconos'

/**
 * Select (Radix).
 *
 * Radix aporta lo que un `<select>` nativo no da y un `<div>` con onClick olvida: `role="combobox"`
 * en el trigger, `role="listbox"`/`option` en la lista, navegacion con flechas + typeahead, el
 * foco atrapado mientras esta abierto y el scroll al item seleccionado.
 *
 * El trigger va a 48px (`h-12`) como el resto de los controles del repo: mobile-first.
 *
 * `SelectContent` va en Portal (`position="popper"`), asi que no lo recorta un contenedor con
 * `overflow: hidden`; el ancho minimo lo toma del trigger con la variable que expone Radix.
 */
const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-4 text-base',
      'data-[placeholder]:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
      <IconoChevronAbajo />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={4}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      {/*
        Sin `h-[var(--radix-select-trigger-height)]`: eso clava el viewport a la altura del trigger
        y la lista queda de una sola fila. El alto lo limita `max-h-96` + el scroll de Radix.
      */}
      <SelectPrimitive.Viewport
        className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-sm font-semibold text-muted-foreground', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-lg py-2.5 pl-9 pr-3 text-base outline-none',
      'focus:bg-accent focus:text-accent-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <IconoCheck className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue }
