/**
 * Verificacion publica de la tarjeta: /<slug>/verificar/<token>.
 *
 * Vive en el grupo de rutas (publico) a proposito: NO hereda el layout del tenant, asi que
 * no monta el BottomNav ni el banner de pedido (nada de links a partes privadas) y no
 * depende de BrandingProvider. El branding viaja en la respuesta del endpoint publico.
 */
import { VerificacionTarjeta } from '@/components/tarjeta/VerificacionTarjeta'

export default function VerificarPage() {
  return <VerificacionTarjeta />
}
