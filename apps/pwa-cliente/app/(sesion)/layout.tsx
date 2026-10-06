import { cookies } from 'next/headers'
import { BrandingProvider } from '@/components/BrandingProvider'
import { SucursalProvider } from '@/components/SucursalProvider'
import { GuardiaDeSesion } from '@/components/GuardiaDeSesion'
import { getClienteMe, getNegocio } from '@/lib/api-servidor'

/**
 * Layout de las rutas SIN tenant en la URL (/tarjeta, /historial,
 * /seleccionar-sucursal).
 *
 * El slug no esta en la URL, asi que se resuelve en dos tiempos:
 *
 *   1. SERVIDOR: se reenvia la cookie del cliente a /auth/cliente/me. Si hay
 *      sesion, el negocio sale de ahi y el primer render ya trae el branding
 *      (sin flash de "sin color").
 *   2. CLIENTE: si no hay sesion (o el fetch fallo), GuardiaDeSesion toma el
 *      branding persistido en localStorage. Si tampoco hay, manda al inicio.
 *
 * El paso 2 tiene que ser del lado del cliente: localStorage no existe en el
 * servidor y la cookie es HttpOnly, asi que el servidor no puede saber que
 * negocio miro este dispositivo la ultima vez.
 */
export default async function SesionLayout({ children }: { children: React.ReactNode }) {
  const cookie = cookies().toString()
  const me = await getClienteMe(cookie)

  if (me?.negocio?.slug) {
    const negocio = await getNegocio(me.negocio.slug)
    if (negocio) {
      return (
        <BrandingProvider negocioInicial={negocio} tenant={negocio.slug}>
          <SucursalProvider>{children}</SucursalProvider>
        </BrandingProvider>
      )
    }
  }

  // Sin sesion: decide el cliente con lo persistido.
  return <GuardiaDeSesion>{children}</GuardiaDeSesion>
}
