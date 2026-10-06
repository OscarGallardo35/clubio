/**
 * Checkout: piezas PURAS. Armar el body del pedido y leer el estado del pedido.
 *
 * Los estados salen de `enum EstadoPedido` del schema (verificado, no de memoria):
 * PENDIENTE, CONFIRMADO, EN_PREPARACION, LISTO, ENVIADO, ENTREGADO, CANCELADO, RECHAZADO.
 * Ojo: es EN_PREPARACION (no PREPARANDO) y ademas de CANCELADO existe RECHAZADO.
 */

import type { CrearPedidoBody } from '@/types/api'
import type { EstadoCarrito } from './carrito-maquina'
import { modificadoresParaApi } from './modificadores-seleccion'

export type EstadoPedido =
  | 'PENDIENTE'
  | 'CONFIRMADO'
  | 'EN_PREPARACION'
  | 'LISTO'
  | 'ENVIADO'
  | 'ENTREGADO'
  | 'CANCELADO'
  | 'RECHAZADO'

/**
 * El camino que ve el cliente, en orden. Los dos ultimos no son "pasos": son finales.
 * CANCELADO y RECHAZADO se muestran aparte (no como parte del avance).
 */
export const ORDEN_ESTADOS: EstadoPedido[] = [
  'PENDIENTE',
  'CONFIRMADO',
  'EN_PREPARACION',
  'LISTO',
  'ENVIADO',
  'ENTREGADO',
]

export const ETIQUETAS: Record<EstadoPedido, string> = {
  PENDIENTE: 'Recibido',
  CONFIRMADO: 'Confirmado',
  EN_PREPARACION: 'En preparacion',
  LISTO: 'Listo',
  ENVIADO: 'En camino',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'Rechazado',
}

export function esFinal(estado: EstadoPedido): boolean {
  return estado === 'CANCELADO' || estado === 'RECHAZADO' || estado === 'ENTREGADO'
}

/** Posicion en el timeline, o -1 para los finales que no son parte del avance. */
export function pasoDelTimeline(estado: EstadoPedido): number {
  return ORDEN_ESTADOS.indexOf(estado)
}

/** El timeline con cada paso marcado como alcanzado o no (y si es el actual). */
export function timeline(estado: EstadoPedido): { estado: EstadoPedido; etiqueta: string; alcanzado: boolean; actual: boolean }[] {
  const actual = pasoDelTimeline(estado)
  // Un final fuera del avance (cancelado/rechazado) no marca ningun paso como alcanzado mas alla
  // del que ya estaba: se resuelve en la UI mostrando el mensaje, no el timeline.
  return ORDEN_ESTADOS.map((e, i) => ({
    estado: e,
    etiqueta: ETIQUETAS[e],
    alcanzado: actual >= 0 && i <= actual,
    actual: e === estado,
  }))
}

/** El texto que se muestra para un pedido entregado, que cambia segun el tipo. */
export function textoEntregado(tipo: 'MESA' | 'TAKEAWAY' | 'DELIVERY'): string {
  if (tipo === 'DELIVERY') return 'Tu pedido llego a destino'
  if (tipo === 'MESA') return 'Tu pedido esta en la mesa'
  return 'Tu pedido esta listo para retirar'
}

/**
 * Arma el body de POST /api/pedidos desde el estado del carrito.
 *
 * Dos cosas que NO van: el precio (el backend lo recalcula desde la DB y lo ignora) y los
 * modificadores en su forma interna. `modificadoresParaApi` es el que convierte a
 * `{ grupoId, opcionIds }`, que es lo que espera el DTO.
 *
 * Las notas generales del pedido salen del estado (`notasPedido`), que se persiste con el resto del
 * formulario.
 */
export function armarBody(estado: EstadoCarrito): CrearPedidoBody {
  const notasPedido = estado.notasPedido ?? ''
  const body: CrearPedidoBody = {
    tipo: (estado.tipo ?? 'TAKEAWAY') as CrearPedidoBody['tipo'],
    modoPago: (estado.modoPago ?? 'EFECTIVO') as CrearPedidoBody['modoPago'],
    nombreCliente: estado.cliente.nombre.trim(),
    telefono: estado.cliente.telefono.trim(),
    items: estado.items.map((i) => ({
      itemId: i.itemId,
      cantidad: i.cantidad,
      ...(i.notas.trim() ? { notas: i.notas.trim() } : {}),
      ...(i.modificadores.length > 0 ? { modificadores: modificadoresParaApi(i.modificadores) } : {}),
    })),
  }
  if (estado.tipo === 'DELIVERY' && estado.cliente.direccion?.trim()) {
    body.direccion = estado.cliente.direccion.trim()
  }
  if (estado.tipo === 'MESA' && estado.cliente.mesa?.trim()) {
    body.mesa = estado.cliente.mesa.trim()
  }
  if (notasPedido.trim()) body.notas = notasPedido.trim()
  if (estado.sucursalId) body.sucursalId = estado.sucursalId
  if (estado.sucursalSlug) body.sucursalSlug = estado.sucursalSlug
  return body
}
