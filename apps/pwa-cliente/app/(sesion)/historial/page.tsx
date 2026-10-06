import { Placeholder } from '@/components/Placeholder'

export const metadata = { title: 'Mi historial' }

export default function HistorialPage() {
  return (
    <Placeholder
      titulo="Mi historial"
      detalle="Acá va la lista de visitas de GET /visitas/mi-historial, con fecha, sellos y quién aprobó."
    />
  )
}
