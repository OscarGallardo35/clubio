import { redirect } from 'next/navigation';
import { RUTA_INICIO } from '@/lib/constants';

/**
 * Raiz del panel.
 *
 * Sin sesion, el middleware ya mando a `/login` antes de llegar aca; con sesion esta
 * pagina manda al inicio del panel. Es un `redirect` de servidor (no un `useEffect`)
 * para que no haya un parpadeo de pagina vacia.
 */
export default function RaizPage() {
  redirect(RUTA_INICIO);
}
