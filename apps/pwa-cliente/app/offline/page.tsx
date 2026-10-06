import { Placeholder } from '@/components/Placeholder'

export const metadata = { title: 'Sin conexión' }

/** Fuera del grupo (sesion) a proposito: tiene que verse aunque no haya branding. */
export default function OfflinePage() {
  return (
    <Placeholder
      titulo="Sin conexión"
      detalle="Revisá tu internet y volvé a intentarlo. Esta pantalla no depende del negocio."
    />
  )
}
