'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * Fades de los bordes cuando hay contenido para scrollear.
 *
 * Los dos prefijos (`-webkit-mask-image` y `mask-image`) van a proposito: Tailwind
 * emite solo el estandar y Safari pide el prefijado (y esto se mira en el celular).
 */
// Clases definidas en el stylesheet del package: la mascara en formato arbitrario
// de Tailwind no se emitia (ni con _ ni con calc). Ver .tabs-fade-* en globals.css.
const FADE_DERECHA = 'tabs-fade-derecha'
const FADE_IZQUIERDA = 'tabs-fade-izquierda'
const FADE_AMBOS = 'tabs-fade-ambos'

/**
 * TabsList scrolleable en horizontal.
 *
 * OJO con dos cosas:
 *
 * 1. NO puede ser `inline-flex`: un inline-flex se dimensiona al contenido, asi que
 *    crece mas alla del padre y los tabs se desbordan SIN que aparezca el scroll
 *    (el `overflow-x-auto` nunca se activa porque el elemento no tiene limite).
 *    Va `flex` + `w-full`: caja de bloque, limitada por el padre, y el contenido
 *    scrollea adentro.
 * 2. Los triggers llevan `shrink-0`, si no flex los aplasta en vez de scrollear.
 *
 * El fade de los bordes es condicional y medido: con dos tabs cortos que entran, un
 * gradiente fijo se comeria el ultimo tab sin motivo.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const propio = React.useRef<HTMLDivElement | null>(null)
  const [bordes, setBordes] = React.useState({ izquierda: false, derecha: false })

  const medir = React.useCallback(() => {
    const el = propio.current
    if (!el) return
    const izquierda = el.scrollLeft > 3
    const derecha = el.scrollLeft + el.clientWidth < el.scrollWidth - 3
    setBordes((b) => (b.izquierda === izquierda && b.derecha === derecha ? b : { izquierda, derecha }))
  }, [])

  // Medicion de DOM que afecta el render -> useLayoutEffect (regla del repo).
  // Isomorfo para no romper el SSR.
  const alMontar = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

  alMontar(() => {
    medir()
    const el = propio.current
    if (!el) return
    el.addEventListener('scroll', medir, { passive: true })
    // El ancho disponible cambia al rotar el telefono o al cambiar el layout.
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => {
      el.removeEventListener('scroll', medir)
      observador.disconnect()
    }
  }, [medir])

  const fade =
    bordes.izquierda && bordes.derecha
      ? FADE_AMBOS
      : bordes.derecha
        ? FADE_DERECHA
        : bordes.izquierda
          ? FADE_IZQUIERDA
          : ''

  return (
    <TabsPrimitive.List
      ref={(nodo) => {
        propio.current = nodo as HTMLDivElement | null
        if (typeof ref === 'function') ref(nodo)
        else if (ref) (ref as React.MutableRefObject<typeof nodo>).current = nodo
      }}
      data-desborda={bordes.izquierda || bordes.derecha ? '' : undefined}
      className={cn(
        // flex + w-full y NO inline-flex: ver el comentario de arriba.
        'flex w-full items-center justify-start gap-1 rounded-2xl bg-muted p-1 text-muted-foreground',
        'overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // snap-x/snap-mandatory son las utilidades nativas: el [scroll-snap-type:...]
        // arbitrario no compilaba (Tailwind no lo emitia).
        'snap-x snap-mandatory',
        fade,
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium',
      // shrink-0: sin esto flex los aplasta en lugar de scrollear.
      'shrink-0 [scroll-snap-align:start]',
      'ring-offset-background transition-all',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
