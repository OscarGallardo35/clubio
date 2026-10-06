/**
 * Cache de la carta con stale-while-revalidate.
 *
 * Todo lo que decide (que se lee, si hay que ir al backend, que pasa si el fetch falla) es
 * PURAMENTE testeable: el reloj entra como parametro, no se lee de Date.now() aca adentro.
 * El fetch y React viven en el hook (`hooks/useCarta.ts`).
 *
 * Por que en memoria y no en localStorage (pedido explicito): la carta puede tener overrides
 * por sucursal, asi que guardarla en disco arriesga servir precios de otra sucursal despues
 * de un cambio. Se cachea por `carta_<negocioSlug>_<sucursalSlug>` y se descarta al recargar.
 */

export const TTL_CARTA_MS = 5 * 60 * 1000

/** Respuesta de GET /carta?sucursalSlug= (el payload se trata como opaco). */
export interface CartaRespuesta {
  negocio?: { id?: string; nombre?: string; slug?: string; colorPrimario?: string }
  sucursal?: { id?: string; slug?: string; nombre?: string } | null
  categorias: unknown[]
  total?: number
  [k: string]: unknown
}

export interface EntradaCarta<T> {
  datos: T
  /** Timestamp del momento en que se guardo (para el TTL). */
  guardadoEn: number
}

/** Que hacer con lo que hay en cache para una clave. */
export type Lectura = 'fresca' | 'vencida' | 'ausente'

export const AVISO_CARTA_VIEJA =
  'No pudimos actualizar la carta. Estás viendo la última versión guardada.'

/**
 * Clave de cache. Depende SOLO del negocio y la sucursal: cambiar de categoria (que es estado
 * de UI) no puede cambiar la clave, y por eso no dispara ningun fetch.
 */
export function claveDeCarta(negocioSlug: string, sucursalSlug: string | null): string {
  return `carta_${negocioSlug}_${sucursalSlug ?? 'sin-sucursal'}`
}

export function decidirLectura<T>(
  entrada: EntradaCarta<T> | undefined,
  ahora: number,
  ttlMs: number = TTL_CARTA_MS,
): Lectura {
  if (!entrada) return 'ausente'
  if (ahora - entrada.guardadoEn < ttlMs) return 'fresca'
  return 'vencida'
}

export interface EstadoCarta<T> {
  porClave: Record<string, EntradaCarta<T>>
  claveActiva: string | null
  /** Fetch bloqueante en curso (no hay nada que mostrar todavia). */
  cargando: boolean
  /** Hay que pegarle al backend, pero sin bloquear: se muestra lo viejo mientras. */
  refetchPendiente: boolean
  aviso: string | null
}

export type EventoCarta =
  | { tipo: 'SELECCIONAR'; negocioSlug: string; sucursalSlug: string | null; ahora: number; ttlMs?: number }
  | { tipo: 'FETCH_OK'; clave: string; datos: unknown; ahora: number }
  | { tipo: 'FETCH_ERROR'; clave: string }
  | { tipo: 'REFETCH_MANUAL' }
  | { tipo: 'INVALIDAR'; clave: string }
  | { tipo: 'DESCARTAR_AVISO' }

export function estadoCartaInicial<T>(): EstadoCarta<T> {
  return { porClave: {}, claveActiva: null, cargando: false, refetchPendiente: false, aviso: null }
}

export function cartaDeCache<T>(estado: EstadoCarta<T>, clave: string | null): EntradaCarta<T> | undefined {
  return clave ? estado.porClave[clave] : undefined
}

/**
 * Plan de fetch para la clave activa.
 *
 * La politica ya la codifica el reducer en dos banderas: `cargando` (no hay NADA que mostrar)
 * y `refetchPendiente` (hay que ir al backend). Aca solo se traducen a un plan. Ojo: con la
 * cache ausente no tiene sentido hablar de "background", porque no hay datos viejos que
 * mostrar mientras se actualiza.
 */
export function planDeFetch<T>(
  estado: EstadoCarta<T>,
  ahora: number,
  ttlMs: number = TTL_CARTA_MS,
): { bloqueante: boolean; background: boolean; lectura: Lectura } {
  const entrada = cartaDeCache(estado, estado.claveActiva)
  const lectura = decidirLectura(entrada, ahora, ttlMs)
  return {
    bloqueante: estado.cargando,
    background: lectura === 'ausente' ? false : estado.refetchPendiente,
    lectura,
  }
}

export function reducerCarta<T>(estado: EstadoCarta<T>, evento: EventoCarta): EstadoCarta<T> {
  switch (evento.tipo) {
    case 'SELECCIONAR': {
      const clave = claveDeCarta(evento.negocioSlug, evento.sucursalSlug)
      const ttl = evento.ttlMs ?? TTL_CARTA_MS
      const lectura = decidirLectura(estado.porClave[clave], evento.ahora, ttl)
      return {
        ...estado,
        claveActiva: clave,
        // Solo bloquea si no hay NADA para mostrar. Con datos vencidos se muestra lo viejo
        // y se actualiza en background (stale-while-revalidate).
        cargando: lectura === 'ausente',
        refetchPendiente: lectura !== 'fresca',
        aviso: null,
      }
    }

    case 'FETCH_OK':
      return {
        ...estado,
        porClave: { ...estado.porClave, [evento.clave]: { datos: evento.datos as T, guardadoEn: evento.ahora } },
        cargando: false,
        refetchPendiente: false,
        aviso: null,
      }

    case 'FETCH_ERROR':
      // NO se toca `porClave`: lo viejo se sigue mostrando. Si no habia nada, no hay vista.
      return {
        ...estado,
        cargando: false,
        refetchPendiente: false,
        aviso: AVISO_CARTA_VIEJA,
      }

    case 'REFETCH_MANUAL':
      return { ...estado, refetchPendiente: true, aviso: null }

    case 'INVALIDAR': {
      const porClave = { ...estado.porClave }
      delete porClave[evento.clave]
      return { ...estado, porClave }
    }

    case 'DESCARTAR_AVISO':
      return { ...estado, aviso: null }

    default:
      return estado
  }
}
