/**
 * Verificacion publica de la tarjeta: /<slug>/verificar/<token>.
 *
 * Vive en el grupo de rutas (publico) a proposito: NO hereda el layout del tenant, asi que
 * no monta el BottomNav ni el banner de pedido (nada de links a partes privadas) y no
 * depende de BrandingProvider. El branding viaja en la respuesta del endpoint publico.
 */
import { VerificacionTarjeta } from '@/components/tarjeta/VerificacionTarjeta'

// Titulo propio: es una pagina PUBLICA que se comparte por WhatsApp (preview del link).
// noindex: el token va en la URL y no queremos que los buscadores la indexen.
export const metadata = {
  title: 'Verificación de tarjeta',
  robots: { index: false, follow: false },
}

export default function VerificarPage() {
  return <VerificacionTarjeta />
}
