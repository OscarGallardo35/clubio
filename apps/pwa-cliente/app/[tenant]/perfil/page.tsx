'use client'

/**
 * Mi perfil, con el tenant en la URL.
 *
 * Vive dentro del grupo `[tenant]` para heredar el branding del local y el BottomNav (el cliente
 * entra desde la tarjeta o desde el cartel del perfilado, que ya estan en ese arbol). Se resuelve
 * el tenant de la URL y no del estado: la pantalla tiene que poder decir "no tenes cuenta aca" a
 * alguien sin sesion.
 */
import { useParams } from 'next/navigation'
import { PantallaPerfil } from '@/components/perfil/PantallaPerfil'

export default function PerfilPage() {
  const params = useParams<{ tenant?: string }>()
  const slugNegocio = params?.tenant ?? ''
  return <PantallaPerfil slugNegocio={slugNegocio} />
}
