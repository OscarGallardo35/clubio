import type { VisitaPendiente } from '@/types/api';

/**
 * Merge idempotente por token.
 *
 * El WS adelanta el aviso y `/pendientes` es la fuente de verdad, asi que el
 * mismo token puede llegar por los dos caminos: se agrega una sola vez.
 */
export function mergearPendiente(
  lista: VisitaPendiente[],
  nueva: VisitaPendiente,
): VisitaPendiente[] {
  if (lista.some((p) => p.token === nueva.token)) return lista;
  return [nueva, ...lista];
}

/** mm:ss para la cuenta regresiva del token (TTL 5 min). */
export function formatearRestante(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Saca de la lista los que ya vencieron (el refetch tambien lo hace, esto es para el tick local). */
export function sinVencidos(lista: VisitaPendiente[], segundosTranscurridos: number): VisitaPendiente[] {
  return lista.filter((p) => p.segundosRestantes - segundosTranscurridos > 0);
}
