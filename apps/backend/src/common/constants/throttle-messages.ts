/**
 * Mensajes del rate limit (@nestjs/throttler 5.x).
 *
 * OJO: `errorMessage` NO es una opcion de `@Throttle` -- el decorador solo acepta
 * `{ limit, ttl, getTracker, generateKey }` (verificado en los tipos instalados). Es una
 * opcion del `ThrottlerModule` y puede ser una funcion que recibe el ExecutionContext.
 *
 * Por eso los textos viven aca y se resuelven por ruta con `mensajeDeThrottle`: un solo
 * lugar para el copy, sin repetir el string en cada decorador.
 */
export const THROTTLE_MESSAGES = {
  PEDIDOS:
    'Ya hiciste varios pedidos seguidos. Probá en un rato o pedile al personal que lo cargue a mano.',
  PEDIDOS_PUBLICO: 'Estás consultando el pedido muy seguido. Esperá unos segundos y actualizá.',
  VISITAS: 'Demasiadas solicitudes seguidas. Esperá un momento.',
  CLIENTES: 'Demasiados registros seguidos desde esta red.',
  UPSELL: 'Demasiadas consultas seguidas. Seguí con tu pedido.',
  GENERAL: 'Demasiadas solicitudes seguidas. Esperá un momento e intentá de nuevo.',
} as const

export type ClaveMensajeThrottle = keyof typeof THROTTLE_MESSAGES

/**
 * Ruta -> mensaje. La clave es `NombreController.metodo` (lo que expone el
 * ExecutionContext). Si una ruta no esta mapeada cae al mensaje GENERAAL, asi que
 * renombrar un metodo degrada el copy pero no rompe nada.
 */
const MENSAJE_POR_RUTA: Record<string, string> = {
  'PedidosController.crear': THROTTLE_MESSAGES.PEDIDOS,
  'PedidosController.publico': THROTTLE_MESSAGES.PEDIDOS_PUBLICO,
  'UpsellController.calcular': THROTTLE_MESSAGES.UPSELL,
}

/** Resolutor que se le pasa al ThrottlerModule. Sin DI: lee el hander por reflexion. */
export function mensajeDeThrottle(context: import('@nestjs/common').ExecutionContext): string {
  const clase = context.getClass()?.name ?? ''
  const metodo = context.getHandler()?.name ?? ''
  return MENSAJE_POR_RUTA[`${clase}.${metodo}`] ?? THROTTLE_MESSAGES.GENERAL
}
