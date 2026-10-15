import { notFound } from 'next/navigation'
import { DevPerfil } from '@/components/dev-perfil'

export const metadata = { title: 'dev · perfilado progresivo' }

/**
 * Solo en desarrollo: en produccion la ruta no existe (mismo criterio que /dev/flujo y /dev/ui).
 * Sirve para mirar el cartel del perfilado sin juntar 3 visitas reales.
 */
export default function DevPerfilPage() {
  if (process.env.NODE_ENV !== 'development') return notFound()
  return <DevPerfil />
}
