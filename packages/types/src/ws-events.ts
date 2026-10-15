import type { ModoFidelizacion } from './enums';

/**
 * Payload del evento WS `visita:aprobada` (namespace /visitas, sala `cliente:{clienteId}`).
 *
 * ESTE es el unico lugar donde se declara. Lo usan los TRES tramos del pasamanos:
 *   1. el gateway que emite (`VisitasGateway.emitirAprobada`),
 *   2. el mapeador del cliente (`crearSocketVisita`, en `@repo/api-client` / la PWA),
 *   3. el handler del hook que lo despacha al reducer (`useVisitaQr`).
 *
 * Agregar un campo es UNA edicion aca. Si un campo se pierde en silencio, el
 * sospechoso es un tramo que rearma el objeto sin usar este tipo.
 *
 * Compatibilidad: los campos marcados opcionales los agrego la fase HIBRIDO, asi que
 * un backend de una version vieja no los manda y el cliente no debe romperse.
 */
export interface VisitaAprobadaPayload {
  visitaId: string;
  sucursalId: string;
  /** Sellos del cliente (global) DESPUES de acreditar. */
  sellosActuales: number;
  /** Alias de `sellosActuales` que ya consumia el staff (se mantiene por compat). */
  sellosCliente: number;
  /** Sellos de la tarjeta de ESA sucursal (puede diferir con modoClientes POR_SUCURSAL). */
  sellosTarjetaSucursal: number;
  /** True si con esta visita se completo la tarjeta de sellos. */
  premioDesbloqueado: boolean;
  /** Lo que OTORGO esta visita: la confirmacion del cliente lo muestra (HIBRIDO = los dos). */
  sellosOtorgados?: number;
  puntosOtorgados?: number;
  /** Saldo de puntos DESPUES de acreditar. */
  puntosActuales?: number;
  /**
   * Mismos literales que el enum `ModoFidelizacion` (el cable es JSON: no viaja el enum,
   * viaja el string, y el cliente compara contra literales).
   */
  modoFidelizacion?: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO';
  /** True si con esta visita se completo el premio por puntos. */
  premioPuntosDesbloqueado?: boolean;
  aprobadoEn: string;
}

/** Re-export para que el union del payload y el enum del schema no se separen. */
export type { ModoFidelizacion };

/** Par sellos+puntos EFECTIVOS del cliente (respeta GLOBAL vs POR_SUCURSAL del club). */
export interface SaldoPar {
  sellos: number;
  puntos: number;
}

/**
 * Payload del evento WS `saldo:cambiado` (namespace /visitas, sala `cliente:{clienteId}`).
 *
 * Es el evento UNICO de "tu saldo cambio": lo emite `SaldoNotificador.avisar` desde los TRES
 * lugares que mueven el saldo del cliente y que antes no avisaban a la app (`acreditar`,
 * `aplicarRegalo` y `editarMonto`). La PWA Cliente tiene UN solo listener
 * (`hooks/useMiTarjeta`) que revalida la tarjeta; el par `antes`/`despues` viaja en el evento
 * para que cualquier pantalla pueda mostrar el cambio SIN re-consultar.
 *
 * Declarado UNA sola vez (aca), igual que `VisitaAprobadaPayload`.
 */
export interface SaldoCambiadoPayload {
  negocioId: string;
  clienteId: string;
  /** Cuanto sumo (o resto, si es negativo) este cambio en cada eje. */
  sellos: number;
  puntos: number;
  /** Saldo efectivo antes y despues del cambio. Con un cambio de 0 son iguales. */
  saldo: { antes: SaldoPar; despues: SaldoPar };
  /** Que lo movio: 'visita_aprobada' | 'pedido_entregado' | 'disparo_regalo' | 'premio_aceptado' | 'visita_monto_editado'. */
  motivo: string;
  /** Referencia del cambio (id de visita / pedido / premio / disparo), para diagnostico. */
  ref: string | null;
  emitidoEn: string;
}
