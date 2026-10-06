/**
 * Cache de los modificadores de un item, con la normalizacion de precios adentro.
 *
 * Mismo patron que `carta-cache.ts`: el reloj entra por parametro, la politica vive en el
 * estado y `planDeFetch` es la traduccion. La clave es por itemId (cada plato tiene los suyos).
 *
 * LO IMPORTANTE: `normalizarModificadores` convierte `precioExtra` a number. El backend lo
 * manda como string (es un Decimal de Prisma cruzando la API), y si eso llega al modal el
 * precio en vivo sale mal: `"200" + 0` concatena en vez de sumar. Se normaliza ACA, en el
 * punto de entrada, no en cada consumidor.
 */

export const TTL_MODIFICADORES_MS = 5 * 60 * 1000

export const AVISO_MODIFICADORES_VIEJOS =
  'No pudimos actualizar las opciones de este plato. Estás viendo la última versión guardada.'

export type TipoGrupoModificador = 'UNICA_SELECCION' | 'MULTIPLE_SELECCION'

export interface OpcionModificadorPublica {
  id: string
  nombre: string
  /** Siempre number: viene normalizado de `normalizarModificadores`. */
  precioExtra: number
  disponible: boolean
}

export interface GrupoModificadorPublico {
  id: string
  nombre: string
  descripcion?: string | undefined
  tipo: TipoGrupoModificador
  obligatorio: boolean
  minSelecciones: number
  maxSelecciones?: number | undefined
  opciones: OpcionModificadorPublica[]
}

export interface ModificadoresDeItem {
  itemId: string
  itemNombre: string
  precioBase: number
  grupos: GrupoModificadorPublico[]
}

export interface EntradaModificadores {
  datos: ModificadoresDeItem
  guardadoEn: number
}

export type LecturaMods = 'fresca' | 'vencida' | 'ausente'

/** Clave por item: cambiar de plato es otra clave, y por eso pide sus propios grupos. */
export function claveDeModificadores(itemId: string): string {
  return `modificadores_${itemId}`
}

/** `"200"` -> 200. Si no es un numero usable, 0: nunca dejamos pasar un NaN al calculo. */
export function aNumero(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : 0
}

/**
 * Normaliza la respuesta cruda del backend.
 *
 * Defensivo a proposito: lo que llega por HTTP no esta tipado en runtime, y un `precioExtra`
 * raro no puede convertirse en un NaN que ensucie el total del carrito.
 */
export function normalizarModificadores(crudo: unknown): ModificadoresDeItem {
  const d = (crudo ?? {}) as Record<string, unknown>
  const gruposCrudos = Array.isArray(d.grupos) ? d.grupos : []
  const grupos: GrupoModificadorPublico[] = gruposCrudos.map((g) => {
    const gc = (g ?? {}) as Record<string, unknown>
    const opcionesCrudas = Array.isArray(gc.opciones) ? gc.opciones : []
    return {
      id: String(gc.id ?? ''),
      nombre: String(gc.nombre ?? ''),
      ...(gc.descripcion ? { descripcion: String(gc.descripcion) } : {}),
      tipo: gc.tipo === 'MULTIPLE_SELECCION' ? 'MULTIPLE_SELECCION' : 'UNICA_SELECCION',
      obligatorio: gc.obligatorio === true,
      minSelecciones: aNumero(gc.minSelecciones),
      ...(gc.maxSelecciones === null || gc.maxSelecciones === undefined
        ? {}
        : { maxSelecciones: aNumero(gc.maxSelecciones) }),
      opciones: opcionesCrudas.map((o) => {
        const oc = (o ?? {}) as Record<string, unknown>
        return {
          id: String(oc.id ?? ''),
          nombre: String(oc.nombre ?? ''),
          precioExtra: aNumero(oc.precioExtra), // <- el Decimal que llega como string
          disponible: oc.disponible !== false,
        }
      }),
    }
  })
  return {
    itemId: String(d.itemId ?? ''),
    itemNombre: String(d.itemNombre ?? ''),
    precioBase: aNumero(d.precioBase),
    grupos,
  }
}

export function decidirLecturaMods(
  entrada: EntradaModificadores | undefined,
  ahora: number,
  ttlMs: number = TTL_MODIFICADORES_MS,
): LecturaMods {
  if (!entrada) return 'ausente'
  if (ahora - entrada.guardadoEn < ttlMs) return 'fresca'
  return 'vencida'
}

export interface EstadoModificadores {
  porClave: Record<string, EntradaModificadores>
  claveActiva: string | null
  cargando: boolean
  refetchPendiente: boolean
  aviso: string | null
}

export type EventoModificadores =
  | { tipo: 'SELECCIONAR'; itemId: string; ahora: number; ttlMs?: number }
  | { tipo: 'FETCH_OK'; clave: string; datos: ModificadoresDeItem; ahora: number }
  | { tipo: 'FETCH_ERROR'; clave: string }
  | { tipo: 'REFETCH_MANUAL' }
  | { tipo: 'INVALIDAR'; clave: string }
  | { tipo: 'DESCARTAR_AVISO' }

export function estadoModificadoresInicial(): EstadoModificadores {
  return { porClave: {}, claveActiva: null, cargando: false, refetchPendiente: false, aviso: null }
}

export function modificadoresDeCache(
  estado: EstadoModificadores,
  clave: string | null,
): EntradaModificadores | undefined {
  return clave ? estado.porClave[clave] : undefined
}

export function planDeFetchMods(
  estado: EstadoModificadores,
  ahora: number,
  ttlMs: number = TTL_MODIFICADORES_MS,
): { bloqueante: boolean; background: boolean; lectura: LecturaMods } {
  const entrada = modificadoresDeCache(estado, estado.claveActiva)
  const lectura = decidirLecturaMods(entrada, ahora, ttlMs)
  return {
    bloqueante: estado.cargando,
    // Con nada en cache no tiene sentido hablar de background: no hay nada que mostrar.
    background: lectura === 'ausente' ? false : estado.refetchPendiente,
    lectura,
  }
}

export function reducerModificadores(
  estado: EstadoModificadores,
  evento: EventoModificadores,
): EstadoModificadores {
  switch (evento.tipo) {
    case 'SELECCIONAR': {
      const clave = claveDeModificadores(evento.itemId)
      const ttl = evento.ttlMs ?? TTL_MODIFICADORES_MS
      const lectura = decidirLecturaMods(estado.porClave[clave], evento.ahora, ttl)
      return {
        ...estado,
        claveActiva: clave,
        cargando: lectura === 'ausente',
        refetchPendiente: lectura !== 'fresca',
        aviso: null,
      }
    }

    case 'FETCH_OK':
      return {
        ...estado,
        porClave: { ...estado.porClave, [evento.clave]: { datos: evento.datos, guardadoEn: evento.ahora } },
        cargando: false,
        refetchPendiente: false,
        aviso: null,
      }

    case 'FETCH_ERROR':
      // No se toca `porClave`: lo viejo se sigue mostrando.
      return { ...estado, cargando: false, refetchPendiente: false, aviso: AVISO_MODIFICADORES_VIEJOS }

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
