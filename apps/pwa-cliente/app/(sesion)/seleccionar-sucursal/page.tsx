import { Placeholder } from '@/components/Placeholder'

export const metadata = { title: 'Elegí tu local' }

export default function SeleccionarSucursalPage() {
  return (
    <Placeholder
      titulo="Elegí tu local"
      detalle="Acá va la lista de GET /sucursales/publico; al elegir una, SucursalProvider la persiste y cambia la tarjeta mostrada."
    />
  )
}
