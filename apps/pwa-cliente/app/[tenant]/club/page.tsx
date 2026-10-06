import { Placeholder } from '@/components/Placeholder'

export const metadata = { title: 'Sumá tu visita' }

/** QR #2. Acá va FlujoVisita (registro -> solicitar -> esperar -> confirmar -> reseña). */
export default function ClubPage() {
  return (
    <Placeholder
      titulo="Sumá tu visita"
      detalle="QR #2: acá va el flujo completo con WebSocket, respaldo por polling, la animación del sello y la reseña."
    />
  )
}
