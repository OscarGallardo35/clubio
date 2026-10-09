import type { Metadata } from 'next';
import { PantallaValidar } from '@/components/PantallaValidar';

export const metadata: Metadata = { title: 'Validar visita' };

/**
 * Pantalla que abre el STAFF desde el link del WhatsApp del cliente
 * (`/validar?ref=TOKEN`).
 *
 * Es un SERVER component que lee el token de la URL y se lo pasa como prop a la
 * pantalla client: `useSearchParams` obliga a un <Suspense> para poder
 * prerenderizar y es una fuente clasica de "prerender-error" (ya nos paso en
 * /login).
 *
 * La prop NO se llama `ref`: React reserva ese nombre para las refs de DOM.
 */
export default function ValidarPage({ searchParams }: { searchParams?: { ref?: string } }) {
  const token = searchParams?.ref?.trim() ?? '';
  return <PantallaValidar tokenRef={token} />;
}
