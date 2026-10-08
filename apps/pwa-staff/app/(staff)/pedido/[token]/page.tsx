import { permanentRedirect } from 'next/navigation';

/**
 * Compatibilidad con el formato VIEJO del link del mensaje al local.
 *
 * El mensaje de WhatsApp armaba `STAFF_APP_URL/pedido/<linkToken>`: una ruta que NUNCA
 * existio en esta PWA, asi que el staff comia un "This page could not be found". El formato
 * nuevo es `/validar-pedido?ref=<linkToken>` (el validador resuelve el token y entra al
 * detalle del pedido).
 *
 * Los mensajes ya enviados viven en el WhatsApp del cliente para siempre, asi que el formato
 * viejo tiene que seguir entrando: se redirige PERMANENTE (308) al validador, que mantiene la
 * logica en un solo lugar.
 *
 * 308 y no 307: el cambio de formato es definitivo, y el 308 deja que el navegador lo cachee
 * (mismo metodo e igual semantica que el 301, pero sin degradar el metodo a GET).
 */
export default function PedidoLinkViejoPage({ params }: { params: { token: string } }) {
  const token = params?.token?.trim() ?? '';
  permanentRedirect(`/validar-pedido?ref=${token}`);
}
