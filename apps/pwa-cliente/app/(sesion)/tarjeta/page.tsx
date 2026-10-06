import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getClienteMe } from '@/lib/api-servidor'

export const metadata = { title: 'Mi tarjeta' }

/**
 * /tarjeta (sin tenant) queda como puerta de entrada vieja: se redirige a la ruta con tenant, que es
 * la que puede mostrar el estado sin sesion. Con sesion el slug sale del propio /me.
 */
export default async function TarjetaSinTenant() {
  const me = await getClienteMe(cookies().toString())
  redirect(me?.negocio?.slug ? `/${me.negocio.slug}/tarjeta` : '/')
}
