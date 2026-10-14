'use client'

/**
 * ¿El local esta abierto AHORA? Lo calcula el NAVEGADOR con `Intl` (America/Argentina/
 * Buenos_Aires) a partir de la grilla + las excepciones que manda `GET /negocios/publico/:slug`.
 *
 * No hay polling contra el backend: se re-evalua localmente cada 60 s (el estado cambia en
 * saltos de minuto). Es informativo; el gate autoritativo es el POST /pedidos.
 */
import * as React from 'react'
import { useBrandingCtxOpcional } from '@/components/BrandingProvider'
import { calcularEstadoHorario, type EstadoHorarioCliente } from '@/lib/horarios'

const REFRESCO_MS = 60_000

export function useEstaAbierto(tipo: 'atencion' | 'delivery' = 'atencion'): EstadoHorarioCliente {
  // Sin BrandingProvider (pantallas de /dev) no hay grilla: se asume abierto.
  const ctx = useBrandingCtxOpcional()
  const configuracion = ctx?.configuracion ?? null
  const excepciones = ctx?.negocio?.excepciones
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESCO_MS)
    return () => clearInterval(id)
  }, [])

  return React.useMemo(
    () => calcularEstadoHorario(configuracion, excepciones, new Date(), tipo),
    // `tick` obliga a re-evaluar aunque la configuracion no cambie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configuracion, excepciones, tipo, tick],
  )
}
