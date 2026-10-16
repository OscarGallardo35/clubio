'use client'

/**
 * Config efectiva del club (modo de fidelizacion, tasa de puntos, meta de sellos y textos del
 * premio), ya resuelta por el backend para la sucursal del empleado.
 *
 * Es la UNICA fuente: la consumen la lista de pendientes (/visitas) y la pantalla del link del
 * WhatsApp (/validar). Antes, /validar montaba `AccionesVisita` sin esta config y el componente
 * caia a sus defaults (meta de sellos 10 en vez de la real), asi que con una meta de 8 la condicion
 * `sellosActuales >= sellosParaPremio` daba falso y el boton de canje del premio nunca se dibujaba.
 *
 * Se pide UNA vez por pantalla (no por fila). Si falla, degrada a `null`: sin config se aprueba
 * igual (1 sello), que es mejor que bloquear la aprobacion.
 */
import * as React from 'react'
import { configuracionApi } from '@/lib/api'
import type { ConfiguracionEfectivaStaff } from '@/types/api'

export function useConfiguracionEfectiva(): ConfiguracionEfectivaStaff | null {
  const [config, setConfig] = React.useState<ConfiguracionEfectivaStaff | null>(null)

  React.useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const c = await configuracionApi.efectiva()
        if (vivo) setConfig(c)
      } catch {
        // sin config se aprueba igual (1 sello)
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  return config
}
