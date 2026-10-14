import type { Metadata } from 'next';
import { PantallaValidarPremio } from '@/components/PantallaValidarPremio';

export const metadata: Metadata = { title: 'Verificar premio' };

/**
 * Pantalla que abre el STAFF desde el link del WhatsApp
 * (`/validar-premio?ref=TOKEN`), el mismo mecanismo que `/validar?ref=` de las visitas.
 *
 * Es un SERVER component que lee el token de la URL y se lo pasa como prop a la pantalla
 * client (`useSearchParams` obliga a un <Suspense> para poder prerenderizar).
 */
export default function ValidarPremioPage({ searchParams }: { searchParams?: { ref?: string } }) {
  const token = searchParams?.ref?.trim() ?? '';
  return <PantallaValidarPremio tokenRef={token} />;
}
