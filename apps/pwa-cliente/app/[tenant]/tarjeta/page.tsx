'use client'

/**
 * Mi tarjeta, con el tenant en la URL.
 *
 * Se resuelve el tenant de la URL (no del estado) porque esta pantalla tiene que poder mostrar el
 * estado "todavia no tenes tarjeta" a alguien SIN sesion: el branding sale del slug y no hace falta
 * ninguna cookie.
 */
import { useParams } from 'next/navigation'
import { PantallaTarjeta } from '@/components/tarjeta/PantallaTarjeta'

export default function TarjetaPage() {
  const params = useParams<{ tenant?: string }>()
  const slugNegocio = params?.tenant ?? ''
  return <PantallaTarjeta slugNegocio={slugNegocio} />
}
