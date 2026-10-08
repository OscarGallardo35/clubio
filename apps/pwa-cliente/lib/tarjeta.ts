/**
 * Piezas PURAS de la tarjeta (para poder testearlas en node).
 *
 * La forma de la respuesta esta verificada contra el backend, no de memoria.
 */
import type { MiTarjetaRespuesta } from '@/types/api'

/** Los modos del club que cambian lo que muestra la tarjeta. */
export type ModoFidelizacion = 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO'
/** Que contador(es) dibuja la tarjeta. `HIBRIDO` dibuja LOS DOS. */
export type TipoTarjeta = 'VISITAS' | 'PUNTOS' | 'HIBRIDO'

export interface ContadoresDeTarjeta {
  tipo: TipoTarjeta
  mostrarSellos: boolean
  mostrarPuntos: boolean
}

/**
 * Que contadores corresponden al modo del club.
 *
 * Antes `HIBRIDO` se colapsaba a `VISITAS` (una sola barra) porque la tarjeta dibujaba un unico
 * tipo. Ahora el modo HIBRIDO muestra las dos barras: sellos y puntos.
 */
export function tipoDeTarjeta(modoFidelizacion: string | null | undefined): ContadoresDeTarjeta {
  if (modoFidelizacion === 'SOLO_PUNTOS') return { tipo: 'PUNTOS', mostrarSellos: false, mostrarPuntos: true }
  if (modoFidelizacion === 'HIBRIDO') return { tipo: 'HIBRIDO', mostrarSellos: true, mostrarPuntos: true }
  return { tipo: 'VISITAS', mostrarSellos: true, mostrarPuntos: false }
}

/** Un contador con su progreso ya resuelto. */
export interface ContadorTarjeta {
  actuales: number
  meta: number
  premioTexto: string
  premioDesbloqueado: boolean
  faltantes: number
  porcentaje: number
}

export interface VistaTarjeta extends ContadorTarjeta {
  tipo: TipoTarjeta
  mostrarSellos: boolean
  mostrarPuntos: boolean
  /** Los DOS contadores, siempre calculados: la UI dibuja los que correspondan al modo. */
  sellos: ContadorTarjeta
  puntos: ContadorTarjeta
  sucursalNombre: string
  nombreCliente: string
  ultimaVisita: Date | undefined
}

/**
 * `faltantes` y `porcentaje` se recalculan SIEMPRE desde (actuales, meta) y no se copian del
 * backend: los del backend hablan de sellos, y una sola formula evita que la tarjeta muestre dos
 * progresos distintos segun el modo.
 */
function contador(
  actuales: number,
  meta: number,
  premioTexto: string,
  desbloqueado: boolean,
): ContadorTarjeta {
  const m = meta > 0 ? meta : 1
  return {
    actuales,
    meta: m,
    premioTexto: premioTexto || 'un premio',
    premioDesbloqueado: desbloqueado || actuales >= m,
    faltantes: Math.max(0, m - actuales),
    porcentaje: Math.min(100, Math.round((actuales / m) * 100)),
  }
}

/**
 * Traduce la respuesta de `mi-tarjeta` a lo que necesita `<TarjetaSellos />`.
 *
 * Los campos de nivel superior (`actuales`, `meta`, ...) son el contador PRINCIPAL: el que dibuja
 * la tarjeta de una sola barra. Con `HIBRIDO` el principal son los sellos y ademas viajan
 * `sellos` y `puntos` para dibujar la segunda barra.
 */
export function vistaDeTarjeta(
  r: MiTarjetaRespuesta,
  modoFidelizacion: string | null | undefined,
): VistaTarjeta {
  const c = tipoDeTarjeta(modoFidelizacion)

  const metaSellos = r.sellosParaPremio > 0 ? r.sellosParaPremio : 10
  const metaPuntosBruta = r.premioPorPuntos ?? 100
  const metaPuntos = metaPuntosBruta > 0 ? metaPuntosBruta : 100

  const sellos = contador(r.sellosActuales ?? 0, metaSellos, r.premioTexto ?? '', r.premioDesbloqueado === true)
  const puntos = contador(r.puntosActuales ?? 0, metaPuntos, r.premioTextoPuntos ?? '', (r.puntosActuales ?? 0) >= metaPuntos)
  const principal = c.mostrarSellos ? sellos : puntos

  return {
    ...principal,
    tipo: c.tipo,
    mostrarSellos: c.mostrarSellos,
    mostrarPuntos: c.mostrarPuntos,
    sellos,
    puntos,
    sucursalNombre: r.sucursal?.nombre ?? '',
    nombreCliente: r.cliente?.nombre ?? '',
    ultimaVisita: r.cliente?.ultimaVisita ? new Date(r.cliente.ultimaVisita) : undefined,
  }
}
