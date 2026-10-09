/**
 * Personalizacion visual de la tarjeta del cliente por tenant.
 *
 * El JSON vive en `Negocio.theme` (schema.prisma). Aca se tipa y se resuelve con
 * fallback a defaults NEUTROS: si a un theme le falta un color, se usa el neutro
 * del campo y la tarjeta sigue siendo valida (no queda con `undefined` en CSS).
 *
 * `getTheme()` devuelve `null` cuando el negocio NO tiene theme util: ese null es
 * la senal para que el componente dibuje el diseno historico POR DEFECTO (asi la
 * regresion de /bar-la-esquina/tarjeta queda intacta).
 */

/** Paleta del theme, en HEX (o cualquier color CSS valido). */
export interface ColoresTheme {
  /** Fondo principal de la tarjeta (fallback si no carga `imagenFondo`). */
  bg: string
  /** Acento: sello lleno, barra de progreso, confeti. */
  accent: string
  /** Marca oscura: track de la barra, borde del sello, overlay de la imagen. */
  brandDark: string
  /** Texto principal. */
  text: string
  /** Texto secundario (equivale a "text/40" del diseno). */
  textMuted: string
}

/** Detalles del sello. */
export interface StampTheme {
  /** Rotacion base (grados) que se suma a la rotacion estable por indice. */
  rotacionBase?: number
  /** Forma del sello lleno. Hoy solo `circulo`. */
  forma?: 'circulo'
}

export interface TenantTheme {
  colores: ColoresTheme
  sello?: StampTheme
  /** Path publico de la imagen de fondo (ej: /tenants/<slug>/bg.webp). Null = solo `bg`. */
  imagenFondo?: string | null
  /** false = ocultar el bloque de puntos (modo HIBRIDO). */
  mostrarPuntos?: boolean
}

/** Defaults neutros: rellenan los huecos de un theme incompleto. */
export const THEME_NEUTRO: TenantTheme = {
  colores: {
    bg: '#111827',
    accent: '#F59E0B',
    brandDark: '#374151',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.45)',
  },
  sello: { rotacionBase: 0, forma: 'circulo' },
  imagenFondo: null,
  mostrarPuntos: true,
}

/** Estructura minima de lo que se le pasa: alcanza con que tenga `theme`. */
export interface ConTheme {
  theme?: unknown
}

/** true solo si hay un theme objeto y con al menos un campo. */
export function tieneTheme(negocio: ConTheme | null | undefined): boolean {
  const t = negocio?.theme
  return !!t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t as object).length > 0
}

/**
 * Resuelve el theme de un negocio con fallback neutro campo por campo.
 * Devuelve `null` si no hay theme -> el consumidor usa el diseno por defecto.
 */
export function getTheme(negocio: ConTheme | null | undefined): TenantTheme | null {
  if (!tieneTheme(negocio)) return null
  const raw = negocio?.theme as Record<string, unknown>
  const colores = (raw.colores ?? {}) as Partial<ColoresTheme>
  const sello = (raw.sello ?? {}) as Partial<StampTheme>

  return {
    colores: {
      bg: colores.bg ?? THEME_NEUTRO.colores.bg,
      accent: colores.accent ?? THEME_NEUTRO.colores.accent,
      brandDark: colores.brandDark ?? THEME_NEUTRO.colores.brandDark,
      text: colores.text ?? THEME_NEUTRO.colores.text,
      textMuted: colores.textMuted ?? THEME_NEUTRO.colores.textMuted,
    },
    sello: { rotacionBase: sello.rotacionBase ?? 0, forma: sello.forma ?? 'circulo' },
    imagenFondo: typeof raw.imagenFondo === 'string' && raw.imagenFondo.length > 0 ? raw.imagenFondo : null,
    mostrarPuntos: raw.mostrarPuntos !== false,
  }
}
