/**
 * ACEPTAR un premio desde la notificacion: /<slug>/premio/<token>.
 *
 * Ruta PROPIA (no query param): el service worker solo ENFOGA la ventana si coincide
 * el `pathname` (`sw-push.js` ignora el query), asi que un `?token=` haria que cada
 * notificacion abriera/navegara raro. Vive dentro del grupo `[tenant]` para heredar
 * `BrandingProvider` y el BottomNav del local.
 *
 * Noindex: el token va en la URL y no queremos que los buscadores la indexen.
 */
import { PremioAceptar } from '@/components/premio/PremioAceptar'

export const metadata = {
  title: 'Tu premio',
  robots: { index: false, follow: false },
}

export default function PremioPage() {
  return <PremioAceptar />
}
