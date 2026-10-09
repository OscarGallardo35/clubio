'use client'

import * as React from 'react'

/**
 * prefers-reduced-motion como estado de React.
 *
 * SSR-safe: arranca en `false` (el HTML del servidor no puede conocer la
 * preferencia) y se corrige en el primer efecto. Se usa para pasarle
 * `reducedMotion` a <TarjetaSellos /> sin que el componente lea el hook adentro
 * (asi sigue siendo testeable y se puede forzar desde afuera).
 */
export function useReducedMotion(): boolean {
  const [reducido, setReducido] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const actualizar = () => setReducido(mq.matches)
    actualizar()
    mq.addEventListener('change', actualizar)
    return () => mq.removeEventListener('change', actualizar)
  }, [])

  return reducido
}
