'use client'

import * as React from 'react'

/**
 * Estado de conexion. `navigator.onLine` miente un poco (dice online si hay
 * interfaz aunque no haya ruta al backend), asi que ademas se puede marcar
 * "sin conexion real" cuando una request falla a nivel de red.
 */
export function useEnLinea() {
  const [enLinea, setEnLinea] = React.useState(true)
  const [falloDeRed, setFalloDeRed] = React.useState(false)

  React.useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine)
    actualizar()
    window.addEventListener('online', actualizar)
    window.addEventListener('offline', actualizar)
    return () => {
      window.removeEventListener('online', actualizar)
      window.removeEventListener('offline', actualizar)
    }
  }, [])

  return {
    enLinea,
    falloDeRed,
    marcarFalloDeRed: () => setFalloDeRed(true),
    limpiarFalloDeRed: () => setFalloDeRed(false),
    /** Lo que importa para mostrar la pantalla offline. */
    sinConexion: !enLinea || falloDeRed,
  }
}
