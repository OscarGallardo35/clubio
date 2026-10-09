/**
 * Checkout: piezas PURAS. Armar el body del pedido y leer el estado del pedido.
 *
 * Los estados salen de `enum EstadoPedido` del schema (verificado, no de memoria):
 * PENDIENTE, CONFIRMADO, EN_PREPARACION, LISTO, ENVIADO, ENTREGADO, CANCELADO, RECHAZADO.
 * Ojo: es EN_PREPARACION (no PREPARANDO) y ademas de CANCELADO existe RECHAZADO.
 */

import type { CrearPedidoBody } from '@/types/api'
import type { EstadoCarrito } from './carrito-maquina'
import { modificadoresParaApi } from './modificadores-seleccion.ts'

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

/**
 * Etiqueta visible de cada forma de pago. Antes se armaba con `toLowerCase().replace('_',' ')`, que
 * daba "efectivo" en minuscula: los enums del backend vienen en MAYUSCULAS y no son copy para el
 * usuario.
 */
/**
 * Link de WhatsApp para el staff a partir del numero del atendiente.
 *
 * La base es `https://wa.me/<numero sin simbolos>`: NO la `urlCorta` (esa es la pagina del pedido en
 * la app del staff, no un enlace de WhatsApp). El mensaje ya trae adentro el link del staff, asi que
 * aca solo se cambia la base.
 * Devuelve `null` si no hay digitos: sin numero no se puede armar el link (y el boton no se muestra).
 */
export function urlWhatsAppStaff(numero: string | null | undefined, mensaje: string): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '')
  if (!digitos) return null
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`
}

export type FalloSeguimiento = 'no-encontrado' | 'vencido' | 'otro' | 'tenant'

/**
 * Clasifica el fallo del GET publico del pedido (`/api/pedidos/publico/:linkToken`).
 *
 * OJO: en ESTE endpoint el 404 significa dos cosas OPUESTAS y se distinguen por el body, no por el
 * status:
 * - "Falta el tenant (X-Tenant-Slug) para esta operacion" -> REINTENTABLE. El header lo fija el
 *   `api.setTenant` del BrandingProvider en un useEffect, y los efectos de React corren de hijo a
 *   padre: en una carga en frio el fetch del seguimiento sale ANTES y el backend contesta esto. Con
 *   el proximo intento ya anda.
 * - "Pedido no encontrado" -> TERMINAL. Ese link no existe: no hay nada que reintentar.
 * Confundirlos deja un pedido valido mostrando "no encontrado" y, peor, corta el polling.
 */
export function clasificarFalloPedido(status: number, mensaje: string): FalloSeguimiento {
  const m = (mensaje ?? '').toLowerCase()
  if (status === 404) return m.includes('falta el tenant') ? 'tenant' : 'no-encontrado'
  if (status === 410) return 'vencido'
  return 'otro'
}

/**
 * ¿Este fallo del seguimiento tiene que SOLTAR el pedido guardado?
 *
 * Hay DOS fallos terminales, no uno:
 * - `no-encontrado` (404 real): ese link no existe mas.
 * - `vencido` (410): el pedido existe, pero su link ya no sirve para seguirlo.
 *
 * Los dos dejan el banner "Ver estado de tu pedido" apuntando a un link muerto. Si no se suelta, el
 * cliente entra, ve el error, vuelve al menu y el banner sigue ahi: un loop. (`tenant` y `otro` son
 * transitorios: el link puede seguir siendo bueno, no se toca nada.)
 *
 * Solo suelta si el pedido guardado es EL MISMO que se estaba siguiendo: si el cliente ya armo un
 * pedido nuevo, el link viejo no tiene por que borrarlo.
 */
export function debeOlvidarPedido(
  fallo: FalloSeguimiento,
  linkTokenSeguido: string,
  linkTokenGuardado: string | null | undefined,
): boolean {
  if (fallo !== 'no-encontrado' && fallo !== 'vencido') return false
  return Boolean(linkTokenGuardado) && linkTokenGuardado === linkTokenSeguido
}

export const ETIQUETAS_MODO_PAGO: Record<'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA', string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  TARJETA: 'Tarjeta',
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

/**
 * Convierte lo que sea que haya lanzado el cliente de API en `{ status, mensaje }`.
 *
 * Dos cosas que no son obvias y por eso viven aca, con su asercion:
 * - Si la request ni salio (sin red, DNS, servidor caido), NO hay `ApiError`: se sintetiza
 *   status 0, que es el unico caso que el hook reintenta.
 * - El `message` del backend puede venir como ARRAY (class-validator devuelve
 *   `{"message":["property x should not exist"]}`), asi que hay que unirlo en vez de mostrarlo
 *   crudo (saldria "[object Object]").
 */
export function normalizarError(e: unknown): { status: number; mensaje: string; data?: unknown } {
  const conStatus =
    e && typeof e === 'object' && 'status' in e && typeof (e as { status?: unknown }).status === 'number'
  if (!conStatus) {
    return { status: 0, mensaje: e instanceof Error ? e.message : '' }
  }
  const status = (e as { status: number }).status
  const data = (e as { data?: unknown }).data
  let mensaje = ''
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message
    if (Array.isArray(m)) mensaje = m.filter((x): x is string => typeof x === 'string').join(' ')
    else if (typeof m === 'string') mensaje = m
  }
  if (!mensaje && e instanceof Error) mensaje = e.message
  // `data` viaja entero: hay errores (el 409 de "pedido activo") que traen campos propios que la
  // UI necesita, y clasificarlos aparte obligaria a repetir la extraccion del payload.
  return { status, mensaje, data }
}
