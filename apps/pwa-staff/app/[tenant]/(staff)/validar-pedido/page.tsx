import type { Metadata } from 'next';
import { PantallaValidarPedido } from '@/components/PantallaValidarPedido';

export const metadata: Metadata = { title: 'Abrir pedido' };

/**
 * Pantalla que abre el STAFF desde el link del WhatsApp del cliente
 * (`/validar-pedido?ref=TOKEN`).
 *
 * Server component que lee el token de la URL y se lo pasa como prop a la pantalla
 * client: `useSearchParams` obliga a un <Suspense> para poder prerenderizar y es una
 * fuente clasica de "prerender-error" (ya paso en /login).
 *
 * La prop NO se llama `ref`: React reserva ese nombre para las refs de DOM.
 */
export default function ValidarPedidoPage({ searchParams }: { searchParams?: { ref?: string } }) {
  const token = searchParams?.ref?.trim() ?? '';
  return <PantallaValidarPedido tokenRef={token} />;
}
