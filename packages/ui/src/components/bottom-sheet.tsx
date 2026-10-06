'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { cn } from '../lib/utils'

/**
 * BottomSheet mobile.
 *
 * La a11y y el comportamiento de dialogo (role=dialog, aria-modal, focus trap,
 * Escape, bloqueo de scroll del body) los aporta @radix-ui/react-dialog, que ya
 * era dependencia y esta probado. Encima va el drag con framer-motion.
 *
 * NO se usa DialogPrimitive.Portal a proposito: el Portal necesita `document`
 * (en SSR el contenedor es null y no renderiza nada) y aca el sheet es fijo a
 * pantalla completa, asi que no hay ganancia de apilado que justifique perder
 * el render en servidor.
 */

export type AlturaSheet = 'auto' | 'media' | 'completa'

export interface BottomSheetProps {
  abierto: boolean
  onCerrar: () => void
  titulo?: string
  altura?: AlturaSheet
  mostrarDragHandle?: boolean
  cerrarAlClickFuera?: boolean
  cerrarAlSwipeDown?: boolean
  /** Se propaga por prop (no se lee el hook adentro) para que sea testeable. */
  reducedMotion?: boolean
  className?: string
  children: React.ReactNode
}

const ALTURA: Record<AlturaSheet, string> = {
  // auto: se ajusta al contenido; el tope evita que tape toda la pantalla.
  auto: 'max-h-[85dvh]',
  media: 'h-[50dvh]',
  completa: 'h-[90dvh]',
}

/** Umbrales de cierre del swipe (refinamiento 1). */
const UMBRAL_PX = 100
const UMBRAL_VELOCIDAD = 500

const BottomSheet = ({
  abierto,
  onCerrar,
  titulo,
  altura = 'auto',
  mostrarDragHandle = true,
  cerrarAlClickFuera = true,
  cerrarAlSwipeDown = true,
  reducedMotion,
  className,
  children,
}: BottomSheetProps) => {
  // El caller puede forzarlo; si no, se respeta la preferencia del sistema.
  const prefiereReducido = useReducedMotion()
  const reducido = reducedMotion ?? prefiereReducido ?? false

  const y = useMotionValue(0)
  const dragControls = useDragControls()
  // El backdrop acompana al dedo: se desvanece a medida que el sheet baja.
  const opacidadBackdrop = useTransform(y, [0, 320], [0.5, 0])
  // Se usa para que un arrastre no dispare el onClick de cerrar.
  const fueDrag = React.useRef(false)

  const alTerminarDrag = (_e: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (!cerrarAlSwipeDown) {
      y.set(0)
      return
    }
    const superaDistancia = info.offset.y > UMBRAL_PX
    const superaVelocidad = info.velocity.y > UMBRAL_VELOCIDAD
    if (superaDistancia || superaVelocidad) onCerrar()
    // Si no supera el umbral, dragConstraints lo devuelve solo con un spring.
  }

  const transicion = reducido
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 260, damping: 18 }

  return (
    <DialogPrimitive.Root
      open={abierto}
      onOpenChange={(abiertoAhora) => {
        if (!abiertoAhora) onCerrar()
      }}
    >
      <AnimatePresence>
        {abierto ? (
          <>
            {/* Backdrop */}
            <DialogPrimitive.Overlay asChild>
              {/*
                Dos capas a proposito: framer no permite animar `opacity` por
                keyframes Y manejarla con un MotionValue a la vez. La capa
                externa hace el fade de entrada/salida y la interna la sigue al
                dedo durante el drag; el alfa visible es el producto de las dos.
              */}
              <motion.div
                aria-hidden="true"
                data-slot="bottom-sheet-backdrop"
                className="fixed inset-0 z-50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  data-slot="bottom-sheet-backdrop-capa"
                  className="absolute inset-0 bg-black"
                  style={{ opacity: reducido ? 0.5 : opacidadBackdrop }}
                />
              </motion.div>
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content
              asChild
              // Click afuera (incluye el backdrop): por defecto cierra.
              onPointerDownOutside={(e) => {
                if (!cerrarAlClickFuera) e.preventDefault()
              }}
              onInteractOutside={(e) => {
                if (!cerrarAlClickFuera) e.preventDefault()
              }}
              aria-describedby={undefined}
            >
              <motion.div
                data-slot="bottom-sheet"
                // Radix deja role="dialog" pero NO setea aria-modal: lo
                // declaramos para que el lector de pantalla marque el resto
                // como inerte mientras el sheet esta abierto.
                aria-modal={true}
                style={{ y }}
                drag="y"
                dragControls={dragControls}
                // top fijo (no se puede estirar hacia arriba), bottom elastico.
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.5 }}
                onDragStart={() => {
                  fueDrag.current = false
                }}
                onDrag={(_e, info) => {
                  if (Math.abs(info.offset.y) > 6) fueDrag.current = true
                }}
                onDragEnd={alTerminarDrag}
                initial={reducido ? { y: 0, opacity: 1 } : { y: '100%' }}
                animate={{ y: 0, opacity: 1 }}
                exit={reducido ? { y: 0, opacity: 0 } : { y: '100%' }}
                transition={transicion}
                className={cn(
                  'fixed inset-x-0 bottom-0 z-50 flex flex-col',
                  'rounded-t-3xl border-t border-border bg-background shadow-2xl',
                  // max-height: descuenta el alto del handle y el safe-area de arriba.
                  'max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))]',
                  ALTURA[altura],
                  className,
                )}
              >
                {mostrarDragHandle ? (
                  <button
                    type="button"
                    aria-label="Cerrar"
                    data-slot="bottom-sheet-handle"
                    onPointerDown={(e) => {
                      // El arrastre se inicia solo desde el handle o desde el
                      // contenido cuando ya esta scrolleado arriba.
                      dragControls.start(e)
                    }}
                    onClick={() => {
                      if (!fueDrag.current) onCerrar()
                    }}
                    className="flex w-full shrink-0 touch-none cursor-grab justify-center py-3 active:cursor-grabbing"
                  >
                    <span className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </button>
                ) : null}

                {titulo ? (
                  <DialogPrimitive.Title className="shrink-0 px-5 pb-2 text-lg font-semibold">
                    {titulo}
                  </DialogPrimitive.Title>
                ) : (
                  // Radix exige un Title (o aria-label) para no avisar por a11y.
                  <DialogPrimitive.Title className="sr-only">
                    {titulo ?? 'Panel'}
                  </DialogPrimitive.Title>
                )}

                <div
                  data-slot="bottom-sheet-contenido"
                  // overscroll-contain: al llegar al final no encadena el scroll
                  // al body (el clasico "se me movio toda la pagina" en iOS).
                  className="flex-1 overflow-y-auto overscroll-contain px-5"
                  style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
                  onPointerDown={(e) => {
                    // Arrastrar el contenido solo si esta arriba de todo.
                    const el = e.currentTarget
                    if (el.scrollTop <= 0) dragControls.start(e)
                  }}
                >
                  {children}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

BottomSheet.displayName = 'BottomSheet'

export { BottomSheet }
