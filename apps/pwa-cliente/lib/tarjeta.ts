/**
 * Piezas PURAS de la tarjeta de sellos (para poder testearlas en node).
 *
 * La forma de la respuesta esta verificada contra el backend, no de memoria.
 */
import type { MiTarjetaRespuesta } from '@/types/api'

export type TipoTarjeta = 'VISITAS' | 'PUNTOS'

/**
 * `ModoFidelizacion` del schema: SOLO_VISITAS | SOLO_PUNTOS | HIBRIDO.
 * `<TarjetaSellos />` dibuja un solo tipo, asi que:
 * - SOLO_PUNTOS -> PUNTOS
 * - SOLO_VISITAS y HIBRIDO -> VISITAS (en HIBRIDO la tarjeta de visitas es la principal; una vista
 *   de puntos separada queda fuera de este alcance).
 */
export function tipoDeTarjeta(modoFidelizacion: string | null | undefined): TipoTarjeta {
  return modoFidelizacion === 'SOLO_PUNTOS' ? 'PUNTOS' : 'VISITAS'
}

export interface VistaTarjeta {
  tipo: TipoTarjeta
  actuales: number
  meta: number
  premioTexto: string
  premioDesbloqueado: boolean
  faltantes: number
  porcentaje: number
  sucursalNombre: string
  nombreCliente: string
  ultimaVisita: Date | undefined
}

/**
 * Traduce la respuesta de mi-tarjeta a lo que necesita `<TarjetaSellos />`.
 * `faltantes` y `porcentaje` se recalculan SIEMPRE desde (actuales, meta) y no se copian del
 * backend: con tipo = PUNTOS los del backend hablan de sellos, y una sola formula evita que la
 * tarjeta muestre dos progresos distintos segun el modo.
 */
export function vistaDeTarjeta(
  r: MiTarjetaRespuesta,
  modoFidelizacion: string | null | undefined,
): VistaTarjeta {
  const tipo = tipoDeTarjeta(modoFidelizacion)
  const actuales = tipo === 'PUNTOS' ? (r.puntosActuales ?? 0) : (r.sellosActuales ?? 0)
  const meta = r.sellosParaPremio > 0 ? r.sellosParaPremio : 10
  return {
    tipo,
    actuales,
    meta,
    premioTexto: r.premioTexto || 'un premio',
    premioDesbloqueado: r.premioDesbloqueado === true || actuales >= meta,
    faltantes: Math.max(0, meta - actuales),
    porcentaje: Math.min(100, Math.round((actuales / meta) * 100)),
    sucursalNombre: r.sucursal?.nombre ?? '',
    nombreCliente: r.cliente?.nombre ?? '',
    ultimaVisita: r.cliente?.ultimaVisita ? new Date(r.cliente.ultimaVisita) : undefined,
  }
}
