'use client'

/**
 * Cadencia de los sondeos (polling) del cliente.
 *
 * Todo lo de aca es PURO y no importa React: asi se puede probar en node pelado
 * (`pnpm --filter pwa-cliente check:sondeo`). Los hooks solo cablean estos valores
 * a `setInterval`/`setTimeout` y a la visibilidad de la pestana.
 */

/* ------------------------------------------------------------------ *
 * Tarjeta (useMiTarjeta): refresco de RESPALDO
 * ------------------------------------------------------------------ */

/**
 * Cada cuanto, como maximo, se revalida la tarjeta cuando el WS no trae nada.
 *
 * Por que 10 s y no menos:
 *  - El camino normal es el WebSocket (`saldo:cambiado` / `visita:aprobada`), que aplica
 *    el cambio en <1 s. Este sondeo existe SOLO para cuando el socket esta dormido o
 *    murio, asi que su trabajo es acotar el "queda vieja para siempre", no competir con el WS.
 *  - 10 s son ~6 GET/min y UN solo GET en vuelo por pantalla, contra los ~1,4 s de latencia
 *    cruzada entre regiones. La pantalla de seguimiento de pedido que YA esta en prod sondea
 *    cada 5 s sin mirar la visibilidad: 10 s y solo con la pestana visible es mas barato que
 *    lo que ya corre.
 *  - Con 10 s la demora percibida con el socket caido pasa de INDEFINIDA a ~11 s (peor caso).
 */
export const RESPALDO_TARJETA_MS = 10_000

/**
 * Decide si toca pegarle al backend ahora.
 *
 * Con la pestana OCULTA nunca se sondea (el cliente no esta mirando y en el fondo el
 * navegador igual throttlea los timers): al volver, el `visibilitychange` refresca en el acto.
 */
export function debeRefrescarRespaldo(
  ahora: number,
  ultimoRefresco: number,
  visible: boolean,
  intervalo: number = RESPALDO_TARJETA_MS,
): boolean {
  if (!visible) return false
  return ahora - ultimoRefresco >= intervalo
}

/**
 * Cuanto falta para que el respaldo tenga sentido, contado desde el ultimo refresco.
 *
 * Lo usa el hook cuando el timer se adelanto (un evento del WS acaba de refrescar): se reprograma
 * lo que FALTA, no un intervalo entero, para no empujar el respaldo al doble.
 */
export function esperaHastaElRespaldo(
  ahora: number,
  ultimoRefresco: number,
  intervalo: number = RESPALDO_TARJETA_MS,
): number {
  return Math.max(500, intervalo - (ahora - ultimoRefresco))
}

/* ------------------------------------------------------------------ *
 * Pantalla de espera del club (useVisitaQr): sondeo de la visita
 * ------------------------------------------------------------------ */

/**
 * Sondeo agresivo los primeros segundos: el cliente esta MIRANDO la pantalla esperando que
 * el local apruebe, y la latencia cruzada entre regiones (~1,4 s por consulta) hace que un
 * intervalo de 5 s se perciba como "+6,5 s de demora". 2,5 s cubre esa ventana.
 */
export const SONDEO_INICIAL_MS = 2500

/** Cuanto dura la ventana agresiva, contada desde que el cliente PIDIO la visita. */
export const VENTANA_INICIAL_MS = 30_000

/** Despues vuelve al intervalo tranquilo (mas o menos el historico de 5 s). */
export const SONDEO_TARDIO_MS = 5000

/**
 * Tope del respaldo por polling, contado desde que se pidio la visita: es la vida del token
 * (5 min). Pasado eso el token ya no puede aprobarse y el flujo se cierra por `EXPIRAR`.
 */
export const TOPE_SONDEO_MS = 300_000

/**
 * Intervalo del proximo sondeo de la visita.
 *
 * `msDesdeElPedido` NO es "cuanto hace que sondea": es cuanto hace que el cliente pidio la
 * visita. Asi la ventana agresiva cubre la espera real aunque el polling arranque mas tarde
 * (el WS tiene 3 s de gracia antes de que se encienda el respaldo).
 */
export function intervaloDeSondeo(msDesdeElPedido: number): number {
  return msDesdeElPedido < VENTANA_INICIAL_MS ? SONDEO_INICIAL_MS : SONDEO_TARDIO_MS
}

/** true cuando el respaldo ya no tiene sentido: el token no puede aprobarse mas. */
export function sondeoVencido(msDesdeElPedido: number): boolean {
  return msDesdeElPedido > TOPE_SONDEO_MS
}
