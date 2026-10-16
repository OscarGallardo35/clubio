'use client'

/**
 * Pantalla HUMANA para el 403 por tenant: la sesion guardada en este telefono es de OTRO local.
 *
 * Es la MISMA pantalla en los dos lugares donde hoy puede aparecer el 403 del `TenantGuard`:
 *  - la tarjeta (`PantallaTarjeta`, cuando `useCliente`/`useMiTarjeta` detectan el mismatch), y
 *  - el flujo del club (`FlujoVisita`), que antes mostraba el TEXTO CRUDO del backend
 *    ("El tenant del token no coincide con la solicitud") con un boton "Reintentar" que volvia a
 *    fallar.
 *
 * Por que vive aca y no duplicado en cada pantalla: un mensaje de error del backend no se muestra
 * crudo en una pantalla de producto, y los MISMOS codigos tienen que verse igual en todas. Antes de
 * extraerlo, el flujo del club tenia su propio tratamiento (el cartel de fallo generico).
 *
 * Ojo con la cookie: es HttpOnly, asi que no se puede borrar desde el navegador. El boton pasa por
 * el logout del backend (`onSalir`) y recien despues navega al club de ESTE local.
 */
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonVariants } from '@repo/ui'
import { RUTAS } from '@/lib/constants'

export interface CambiarDeCuentaProps {
  /** Slug del local en el que se esta parado (a donde se vuelve tras salir). */
  slugNegocio: string
  /** Cierra la sesion del otro local (el logout del backend). */
  onSalir: () => Promise<void>
  /**
   * Explicacion bajo el titulo. Por defecto, la de la tarjeta (que es la pantalla donde nacio este
   * texto); el flujo del club pasa su propia version para no hablar de una tarjeta que no pidio.
   */
  detalle?: string
}

const DETALLE_TARJETA =
  'La sesión guardada en este teléfono es de otro negocio, así que no podemos mostrarte la tarjeta de este club.'

export function CambiarDeCuenta({ slugNegocio, onSalir, detalle }: CambiarDeCuentaProps) {
  const router = useRouter()
  const [saliendo, setSaliendo] = React.useState(false)

  async function cambiar() {
    setSaliendo(true)
    try {
      await onSalir()
    } finally {
      router.replace(RUTAS.club(slugNegocio))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-white drop-shadow">Esta cuenta es de otro local</p>
      <p className="text-sm text-white/85">{detalle ?? DETALLE_TARJETA}</p>
      <button
        type="button"
        onClick={() => void cambiar()}
        disabled={saliendo}
        className={buttonVariants({ className: 'min-h-12' })}
      >
        {saliendo ? 'Saliendo…' : 'Cambiar de cuenta'}
      </button>
      <Link href={RUTAS.club(slugNegocio)} className="text-sm text-white/80 underline underline-offset-4">
        Ir al club de este local
      </Link>
    </div>
  )
}
