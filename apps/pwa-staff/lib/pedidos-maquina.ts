import type { EstadoPedido, TipoPedido } from '@/types/api';

/**
 * ESPEJO de `apps/backend/src/pedidos/helpers/transiciones-estado.ts`.
 *
 * La UI necesita saber que botones mostrar, y el backend RECHAZA con 400 cualquier
 * transicion que no figure alla, asi que este mapa no puede inventar pasos. Si
 * cambia el backend, cambia aca: los casos que importan estan assertados contra la
 * API REAL en check-auth-staff (el espejo no se cree a si mismo).
 */
export const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  PENDIENTE: ['CONFIRMADO', 'RECHAZADO'],
  CONFIRMADO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO', 'CANCELADO'],
  LISTO: ['ENTREGADO', 'ENVIADO'],
  ENVIADO: ['ENTREGADO'],
  ENTREGADO: [],
  CANCELADO: [],
  RECHAZADO: [],
};

/** Los mismos 5 estados que el backend considera "activos". */
export const ESTADOS_ACTIVOS: EstadoPedido[] = [
  'PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO',
];

/**
 * LISTO -> ENVIADO solo tiene sentido en DELIVERY (`transicionValidaParaTipo`):
 * en TAKEAWAY/MESA el pedido se ENTREGA, no se envia.
 */
export function transicionesValidas(desde: EstadoPedido, tipo: TipoPedido): EstadoPedido[] {
  return (TRANSICIONES[desde] ?? []).filter(
    (hacia) => !(desde === 'LISTO' && hacia === 'ENVIADO' && tipo !== 'DELIVERY'),
  );
}

export const ETIQUETA_ACCION: Partial<Record<EstadoPedido, string>> = {
  CONFIRMADO: 'Confirmar',
  EN_PREPARACION: 'En preparacion',
  LISTO: 'Listo',
  ENVIADO: 'Enviar',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelar',
  RECHAZADO: 'Rechazar',
};

export const ETIQUETA_ESTADO: Record<EstadoPedido, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparacion',
  LISTO: 'Listo',
  ENVIADO: 'Enviado',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'Rechazado',
};

/**
 * Color del badge por estado (refinamiento 8). Clases estaticas y no
 * `bg-[hsl(var(--primary))]` porque son colores de ESTADO, no de marca: el verde
 * de "listo" tiene que ser verde en cualquier local.
 */
export const COLOR_ESTADO: Record<EstadoPedido, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-900 border-amber-300',
  CONFIRMADO: 'bg-blue-100 text-blue-900 border-blue-300',
  EN_PREPARACION: 'bg-orange-100 text-orange-900 border-orange-300',
  LISTO: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  ENVIADO: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  ENTREGADO: 'bg-slate-100 text-slate-700 border-slate-300',
  CANCELADO: 'bg-red-100 text-red-800 border-red-300',
  RECHAZADO: 'bg-red-100 text-red-800 border-red-300',
};

export const ETIQUETA_TIPO: Record<TipoPedido, string> = {
  MESA: 'En mesa',
  TAKEAWAY: 'Para llevar',
  DELIVERY: 'Delivery',
};

/** El backend exige >= 10 caracteres para RECHAZADO (DTO y service). */
export const MIN_MOTIVO = 10;

export function requiereMotivo(hacia: EstadoPedido): boolean {
  return hacia === 'RECHAZADO';
}

/** Pedidos cerrados: no se pueden tocar (y en la lista activa no aparecen). */
export function esFinal(estado: EstadoPedido): boolean {
  return estado === 'ENTREGADO' || estado === 'CANCELADO' || estado === 'RECHAZADO';
}

export function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
