'use client'

/**
 * Estado del local (abierto/cerrado) para el STAFF.
 *
 * A diferencia del cliente, aca se le pregunta al backend (`GET /horarios/estado`): es la
 * fuente autoritativa (incluye feriados/cierres) y la sesion del staff esta autenticada, asi
 * que un refresco cada 5 minutos no castiga el throttler. El badge NO oculta los pedidos.
 */
import * as React from 'react'
import { horariosApi } from '@/lib/api'
import type { EstadoHorario } from '@/types/api'

const REFRESCO_MS = 5 * 60_000

export function useEstadoLocal(tipo: 'atencion' | 'delivery' = 'atencion'): EstadoHorario | null {
  const [estado, setEstado] = React.useState<EstadoHorario | null>(null)

  React.useEffect(() => {
    let vivo = true
    const cargar = async () => {
      try {
        const r = await horariosApi.estado()
        if (vivo) setEstado(r[tipo])
      } catch {
        // Silencioso: el badge es informativo. Si falla, no se muestra.
        if (vivo) setEstado(null)
      }
    }
    void cargar()
    const id = setInterval(() => void cargar(), REFRESCO_MS)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [tipo])

  return estado
}
