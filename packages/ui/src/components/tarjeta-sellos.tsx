'use client'

import * as React from 'react'
import { motion, type Variants } from 'framer-motion'
import { Circle, Clock, Crown, Gift, Stamp } from 'lucide-react'
import { cn } from '../lib/utils'

/**
 * Forma del theme del tenant tal como la CONSUME este componente.
 *
 * Es ESTRUCTURAL y vive aca a proposito: `@repo/ui` no importa `@repo/types`
 * (su tsconfig fija `rootDir: ./src`, y traer el source de otro package rompe
 * TS6059). El tipo canonico (`TenantTheme`, con `getTheme()`) vive en
 * `@repo/types`; esta es su copia estructural y debe mantenerse en sincronia.
 */
export interface ColoresTemaTarjeta {
  /** Fondo principal de la tarjeta (fallback si no carga `imagenFondo`). */
  bg: string
  /** Acento: sello lleno, barra de progreso, confeti. */
  accent: string
  /** Marca oscura: track de la barra, borde del sello, overlay de la imagen. */
  brandDark: string
  /** Texto principal. */
  text: string
  /** Texto secundario (equivale a "text/40"). */
  textMuted: string
}

export interface SelloTemaTarjeta {
  rotacionBase?: number
  forma?: 'circulo'
}

export interface TemaTarjeta {
  colores: ColoresTemaTarjeta
  sello?: SelloTemaTarjeta
  imagenFondo?: string | null
  mostrarPuntos?: boolean
}

/**
 * Tarjeta de sellos: el componente estrella del producto.
 *
 * El cliente la ve justo despues de que le aprueban la visita, o sea en el
 * momento mas emocional del flujo. Por eso anima, pero con limites:
 *   - la secuencia completa dura < 1.5s
 *   - no bloquea la interaccion (es pointer-events-none lo que decora)
 *   - si el usuario toca o scrollea, se cancelan las animaciones no criticas
 *   - `reducedMotion` llega por PROP (no se lee el hook adentro) para que sea
 *     testeable y para que el caller pueda forzarlo desde una preferencia del
 *     negocio.
 *
 * DOS DISENOS EN UNO:
 *   - SIN `theme` (theme=null/undefined): el diseno HISTORICO, intacto
 *     (regresion de /bar-la-esquina/tarjeta asegurada).
 *   - CON `theme`: fondo `bg` + imagen opcional, sello lleno accent/brandDark con
 *     rotacion estable por indice, barra accent sobre brandDark, y el mensaje
 *     unico "Llevas X de N · Te faltan Y para tu {premio}".
 *
 * OJO con el glassmorphism del diseno historico: `bg-white/10 backdrop-blur-xl
 * border-white/20` necesita un fondo con color detras. Sobre blanco liso la
 * tarjeta se ve plana; va montada sobre el degradado de la marca.
 */

export type EstadoTarjeta = 'vacia' | 'progreso' | 'casi' | 'completa' | 'canjeada'
export type TamanoTarjeta = 'full' | 'medium' | 'small' | 'micro'

/**
 * OJO: las props opcionales llevan `| undefined` a proposito. El monorepo usa
 * exactOptionalPropertyTypes, y sin eso pasar una prop que puede ser undefined
 * (el caso normal: `estado={estadoDerivado}`) NO compila en quien consume.
 */
export interface TarjetaSellosProps {
  nombreCliente?: string | undefined
  nombreNegocio: string
  logoUrl?: string | undefined
  tipo: 'VISITAS' | 'PUNTOS'
  actuales: number
  meta: number
  premioTexto: string
  colorPrimario: string
  colorSecundario: string
  tamaño: TamanoTarjeta
  /** 'glass' para fondos con color (club, tarjeta); 'solida' para el fondo neutro. */
  variante?: 'glass' | 'solida' | undefined
  estado?: EstadoTarjeta | undefined
  mostrarUltimaVisita?: boolean | undefined
  ultimaVisita?: Date | undefined
  onClick?: () => void | undefined
  reducedMotion?: boolean | undefined
  /** Theme del tenant. null/undefined = diseno por defecto (regresion intacta). */
  theme?: TemaTarjeta | null | undefined
  /**
   * Slug del tenant, para derivar el icono de esquina `/icons/<slug>-icono.jpg`
   * (con fallback al generico `/icons/icono.jpg`). Solo se usa en la rama CON
   * theme; la rama historica lo ignora, asi que no afecta la regresion.
   */
  slugTenant?: string | undefined
  className?: string | undefined
}

// --- geometria por tamano -------------------------------------------------
const CONFIG: Record<
  TamanoTarjeta,
  {
    caja: string
    padding: string
    sello: string
    icono: string
    titulo: string
    texto: string
    columnas: number
  }
> = {
  full: {
    // `w-full max-w-[360px]`: en un telefono chico la tarjeta se achica con la pantalla en vez de
    // desbordar; `min-h-[440px]` (antes 560) mantiene la proporcion vertical sin dejar el hueco
    // enorme que quedaba entre el bloque de sellos y la barra cuando el contenido es corto.
    // OJO: este preset lo COMPARTE la tarjeta historica (bar-la-esquina). La tarjeta CON theme
    // usa 400x(alto 580) en el `style` del contenedor (theme-only), sin tocar este valor.
    caja: 'w-full max-w-[360px] min-h-[440px]',
    padding: 'p-7',
    sello: 'size-12',
    icono: 'size-6',
    titulo: 'text-2xl',
    texto: 'text-base',
    columnas: 5,
  },
  medium: {
    caja: 'w-[280px] max-w-full min-h-[440px]',
    padding: 'p-5',
    sello: 'size-10',
    icono: 'size-5',
    titulo: 'text-xl',
    texto: 'text-sm',
    columnas: 5,
  },
  small: {
    caja: 'w-[200px] max-w-full min-h-[320px]',
    padding: 'p-4',
    sello: 'size-7',
    icono: 'size-4',
    titulo: 'text-base',
    texto: 'text-xs',
    columnas: 4,
  },
  micro: {
    caja: 'size-[60px]',
    padding: 'p-1',
    sello: 'size-0',
    icono: 'size-0',
    titulo: 'text-xs',
    texto: 'text-[10px]',
    columnas: 0,
  },
}

/** Deriva el estado cuando el caller no lo pasa explicitamente. */
function derivarEstado(actuales: number, meta: number): EstadoTarjeta {
  if (actuales <= 0) return 'vacia'
  if (actuales >= meta) return 'completa'
  if (meta - actuales === 1) return 'casi'
  return 'progreso'
}

function haceCuanto(fecha: Date): string {
  const min = Math.floor((Date.now() - new Date(fecha).getTime()) / 60000)
  if (min < 1) return 'recien'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} dias`
  const m = Math.floor(d / 30)
  return m === 1 ? 'hace 1 mes' : `hace ${m} meses`
}

function textoMotivacional(estado: EstadoTarjeta, faltan: number, premioTexto: string, tipo: TarjetaSellosProps['tipo']) {
  const unidad = tipo === 'PUNTOS' ? 'puntos' : 'visitas'
  switch (estado) {
    case 'vacia':
      return `Sumá tu primera visita y empezá a juntar ${unidad}`
    case 'casi':
      return `¡Te falta 1 para tu ${premioTexto}!`
    case 'completa':
      return '¡Completaste tu tarjeta!'
    case 'canjeada':
      return 'Premio canjeado'
    default:
      return `Te faltan ${faltan} para tu ${premioTexto}`
  }
}

// --- helpers de color (exportados para poder testearlos en node) ----------

/** #rgb / #rrggbb -> `rgba(r,g,b,a)`. Devuelve null si no es hex valido. */
export function hexARgba(hex: string, alpha: number): string | null {
  const h = hex.trim().replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Rotacion ESTABLE por indice (no random): misma posicion -> mismo angulo. */
export function rotacionSello(indice: number, base = 0): number {
  return base + ((indice * 37) % 21) - 10
}

// --- confeti --------------------------------------------------------------
function Confeti({ cantidad, global, colorPrimario, colorSecundario }: {
  cantidad: number
  global: boolean
  colorPrimario: string
  colorSecundario: string
}) {
  const particulas = React.useMemo(
    () =>
      Array.from({ length: cantidad }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * (global ? 260 : 160),
        giro: (Math.random() - 0.5) * 720,
        demora: Math.random() * 0.12,
        escala: 0.6 + Math.random() * 0.8,
      })),
    [cantidad, global],
  )

  return (
    <div aria-hidden="true" data-slot="tarjeta-confeti" className="pointer-events-none absolute inset-0 overflow-hidden">
      {particulas.map((p) => (
        <motion.span
          key={p.id}
          data-slot="tarjeta-confeti-particula"
          className="absolute left-1/2 top-1/2 block size-2 rounded-[2px]"
          style={{ backgroundColor: p.id % 2 === 0 ? colorPrimario : colorSecundario }}
          initial={{ x: 0, y: 0, opacity: 1, scale: p.escala, rotate: 0 }}
          animate={{ x: p.x, y: (global ? 240 : 140), opacity: 0, rotate: p.giro }}
          transition={{ duration: global ? 1.1 : 0.9, delay: p.demora, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

// --- icono de esquina del tenant ------------------------------------------
/**
 * Icono del tenant, GRANDE, en la esquina superior izquierda del header (al lado
 * del texto del negocio). Reemplaza al avatar con la inicial cuando esta disponible.
 *
 * Fuente en ese orden: `/icons/<slug>-icono.jpg` (override multi-tenant) y, si
 * no existe, el generico `/icons/icono.jpg`. Si tampoco existe, cae al `fallback`
 * (la inicial del negocio): nunca deja cuadro roto ni un hueco vacio. Es decorativo
 * (el nombre del negocio ya esta en el header), asi que va con `alt=""` y `aria-hidden`.
 */
function IconoEsquina({
  slug,
  className,
  fallback,
}: {
  slug: string
  className: string
  /** Nodo a mostrar si ninguna imagen carga (ej. el avatar con la inicial). */
  fallback?: React.ReactNode
}) {
  // 0 = override por slug | 1 = generico | 2 = oculto
  const [etapa, setEtapa] = React.useState<0 | 1 | 2>(slug ? 0 : 1)
  if (etapa === 2) return <>{fallback ?? null}</>
  const src = etapa === 0 ? `/icons/${slug}-icono.jpg` : '/icons/icono.jpg'
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-slot="tarjeta-icono-tenant"
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => setEtapa((e) => (e === 0 ? 1 : 2))}
      className={className}
    />
  )
}

// --- un sello -------------------------------------------------------------
function Sello({
  indice,
  meta,
  lleno,
  esPremio,
  esUltimoNuevo,
  pulsar,
  config,
  colorPrimario,
  theme,
}: {
  indice: number
  meta: number
  lleno: boolean
  esPremio: boolean
  esUltimoNuevo: boolean
  pulsar: boolean
  config: (typeof CONFIG)[TamanoTarjeta]
  colorPrimario: string
  theme: TemaTarjeta | null
}) {
  const etiqueta = `Visita ${indice + 1} de ${meta}, ${lleno ? 'completada' : 'pendiente'}`

  // --- variante con theme: sello lleno = SVG accent + brandDark -------------
  if (theme) {
    const rot = rotacionSello(indice, theme.sello?.rotacionBase ?? 0)
    const propsAnimacionThemed =
      esUltimoNuevo || pulsar
        ? {
            // Sello NUEVO: spring + temblor (shake). El que late (pulsar) es el
            // ultimo lugar cuando la tarjeta esta "casi".
            animate: pulsar
              ? { scale: [1, 1.08, 1], opacity: 1 }
              : { scale: [0.6, 1.15, 1], rotate: [0, -9, 7, 0], opacity: 1 },
            transition: pulsar
              ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const }
              : { type: 'spring' as const, stiffness: 260, damping: 18 },
          }
        : {}
    const estiloThemed = lleno ? ({}) as const : { borderColor: theme.colores.textMuted, color: theme.colores.textMuted }
    return (
      <motion.span
        data-slot="tarjeta-sello"
        data-themed="true"
        aria-label={etiqueta}
        variants={{
          oculto: { scale: 0.9, rotate: 0, opacity: 1 },
          visible: { scale: 1, rotate: 0, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 18 } },
        }}
        {...propsAnimacionThemed}
        // El sello vacio es un circulo dashed en text/40 (theme.colores.textMuted).
        className={cn('flex shrink-0 items-center justify-center rounded-full', config.sello, !lleno && 'border-2 border-dashed')}
        style={estiloThemed}
      >
        {lleno ? (
          <svg
            data-slot="tarjeta-sello-svg"
            aria-hidden="true"
            viewBox="0 0 24 24"
            className={config.icono}
            style={{ transform: `rotate(${rot}deg)` }}
            fill={theme.colores.accent}
            stroke={theme.colores.brandDark}
            strokeWidth={1.6}
            strokeLinejoin="round"
          >
            <path d="M12 2.6l2.72 5.5 6.08.88-4.4 4.28 1.04 6.05L12 16.9l-5.44 2.41 1.04-6.05-4.4-4.28 6.08-.88z" />
          </svg>
        ) : (
          <Circle aria-hidden="true" className={config.icono} />
        )}
      </motion.span>
    )
  }

  // --- variante historica (sin theme) --------------------------------------
  const Icono = esPremio ? Gift : lleno ? Stamp : Circle
  // Se construye el objeto en vez de pasar `undefined`: con
  // exactOptionalPropertyTypes, `style={cond ? {...} : undefined}` no compila.
  const estilo = lleno ? { backgroundColor: colorPrimario } : ({}) as const
  const propsAnimacion =
    esUltimoNuevo || pulsar
      ? {
          animate: pulsar ? { scale: [1, 1.08, 1], rotate: 0, opacity: 1 } : { scale: [0.6, 1.15, 1], rotate: 0, opacity: 1 },
          transition: pulsar ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const } : { type: 'spring' as const, stiffness: 260, damping: 18 },
        }
      : {}

  return (
    <motion.span
      data-slot="tarjeta-sello"
      aria-label={etiqueta}
      variants={{
        // La entrada arranca VISIBLE (0.9), no en 0. Con scale 0 el HTML del
        // servidor sale con los sellos invisibles y la tarjeta queda en blanco
        // hasta que hidrata: en la pantalla mas emocional del flujo eso es un
        // riesgo real si el JS tarda o falla. El pop 0 -> 1 queda para el sello
        // NUEVO (ver propsAnimacion), que siempre ocurre en el cliente.
        oculto: { scale: 0.9, rotate: 0, opacity: 1 },
        visible: {
          scale: 1,
          rotate: 0,
          opacity: 1,
          transition: { type: 'spring', stiffness: 260, damping: 18 },
        },
      }}
      // El ulitmo sello nuevo es el que protagoniza el pop; si esta "casi",
      // ademas late para empujar a volver.
      {...propsAnimacion}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        config.sello,
        lleno
          ? 'text-white shadow-sm'
          : esPremio
            ? 'border-2 border-dashed border-white/60 text-white/70'
            : 'border-2 border-dashed border-white/40 text-white/40',
      )}
      style={estilo}
    >
      <Icono aria-hidden="true" className={config.icono} />
    </motion.span>
  )
}

export function TarjetaSellos({
  nombreCliente,
  nombreNegocio,
  logoUrl,
  tipo,
  actuales,
  meta,
  premioTexto,
  colorPrimario,
  colorSecundario,
  tamaño,
  variante = 'glass',
  estado,
  mostrarUltimaVisita = false,
  ultimaVisita,
  onClick,
  reducedMotion = false,
  theme = null,
  slugTenant,
  className,
}: TarjetaSellosProps) {
  const config = CONFIG[tamaño]
  // Con fondo neutro (modo funcional) el glassmorphism no se ve: la tarjeta
  // necesita fondo y borde propios para no quedar flotando en el vacio.
  const glass = variante === 'glass'
  const total = Math.max(1, meta)
  const llenos = Math.max(0, Math.min(actuales, total))
  const estadoReal = estado ?? derivarEstado(llenos, total)
  const faltan = Math.max(0, total - llenos)
  const completa = estadoReal === 'completa' || estadoReal === 'canjeada'
  const themed = Boolean(theme)

  // --- secuencia de animacion (fases 1 a 6 de la especificacion) ----------
  const previos = React.useRef(llenos)
  const [etapa, setEtapa] = React.useState(0) // 0 quieto | 1 pop | 2 confeti | 3 barra | 4 texto | 5 premio
  const [cancelado, setCancelado] = React.useState(false)
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([])

  const limpiar = React.useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  React.useEffect(() => {
    const previo = previos.current
    const sumo = llenos > previo
    previos.current = llenos
    if (!sumo || reducedMotion || cancelado) return

    limpiar()
    setEtapa(1)
    const push = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms))
    push(() => setEtapa(2), 300) // fase 2: confeti local
    push(() => setEtapa(3), 500) // fase 3: la barra anima al nuevo %
    push(() => setEtapa(4), 800) // fase 4: texto motivacional
    if (llenos >= total) {
      push(() => setEtapa(5), 1100) // fase 5: banner de premio + confeti global
      push(() => {
        // fase 6: vibracion (solo si el dispositivo la soporta y no hay reduced motion)
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(200)
      }, 1100)
    }
    return limpiar
  }, [llenos, total, reducedMotion, cancelado, limpiar])

  // Cancelar animaciones no criticas si el usuario interactua.
  React.useEffect(() => {
    if (reducedMotion) return
    const abortar = () => {
      setCancelado(true)
      limpiar()
      setEtapa(0)
    }
    const opciones: AddEventListenerOptions = { once: true, passive: true }
    window.addEventListener('pointerdown', abortar, opciones)
    window.addEventListener('scroll', abortar, opciones)
    window.addEventListener('wheel', abortar, opciones)
    window.addEventListener('touchstart', abortar, opciones)
    return () => {
      window.removeEventListener('pointerdown', abortar)
      window.removeEventListener('scroll', abortar)
      window.removeEventListener('wheel', abortar)
      window.removeEventListener('touchstart', abortar)
    }
  }, [reducedMotion, limpiar])

  const animar = !reducedMotion && !cancelado
  const porcentaje = Math.round((llenos / total) * 100)
  const saludo = nombreCliente ? `Hola, ${nombreCliente}` : null
  const etiquetaContenedor =
    `Tarjeta de ${nombreNegocio}: ${llenos} de ${total} ${tipo === 'PUNTOS' ? 'puntos' : 'visitas'}. ` +
    (completa ? `Premio desbloqueado: ${premioTexto}` : `Faltan ${faltan} para ${premioTexto}`)

  // Con theme, el premio tambien aparece con `reducedMotion`: solo fade, sin pop
  // ni confeti (spec: "con prefers-reduced-motion solo fade").
  const mostrarPremio = completa && (animar ? etapa >= 5 : reducedMotion)
  // Mensaje unico del diseno con theme. Al completar cambia: "Te faltan 0" no es un mensaje util.
  const mensajeThemed = theme
    ? completa
      ? '¡Completaste tu tarjeta! Mostrale esta pantalla al personal'
      : `Llevas ${llenos} de ${total} · Te faltan ${faltan} para tu ${premioTexto}`
    : null

  // --- confeti del premio (canvas-confetti, solo con theme) ---------------
  React.useEffect(() => {
    if (!themed || !theme || !mostrarPremio || reducedMotion) return
    let activo = true
    void import('canvas-confetti').then((mod) => {
      if (!activo) return
      const confetti = mod.default
      const colores = [theme.colores.accent, theme.colores.brandDark, theme.colores.text]
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: colores, disableForReducedMotion: true })
      setTimeout(() => { if (activo) confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0 }, colors: colores }) }, 180)
      setTimeout(() => { if (activo) confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 }, colors: colores }) }, 360)
    })
    return () => { activo = false }
  }, [themed, theme, mostrarPremio, reducedMotion])

  // --- variante micro: solo el anillo de progreso -------------------------
  if (tamaño === 'micro') {
    return (
      <div
        data-slot="tarjeta-sellos"
        data-tamano="micro"
        role="img"
        aria-label={etiquetaContenedor}
        onClick={onClick}
        className={cn(
          'relative flex size-[60px] items-center justify-center rounded-full',
          glass ? 'border border-white/20 bg-white/10 backdrop-blur-xl' : 'border border-border bg-card',
          onClick && 'cursor-pointer',
          className,
        )}
        style={{ ['--color-primary' as string]: colorPrimario, ['--color-secondary' as string]: colorSecundario }}
      >
        <span className="text-xs font-semibold text-white">
          {llenos}/{total}
        </span>
        <svg aria-hidden="true" viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/20" />
          <circle
            cx="18" cy="18" r="16" fill="none" stroke={colorPrimario} strokeWidth="3"
            strokeLinecap="round" strokeDasharray={`${(porcentaje / 100) * 100.5} 100.5`}
          />
        </svg>
      </div>
    )
  }

  const variantesContenedor: Variants = {
    oculto: {},
    visible: {
      transition: { staggerChildren: animar ? 0.06 : 0, delayChildren: animar ? 0.1 : 0 },
    },
  }

  // Fondo con theme: color `bg` + imagen opcional. Si la imagen no existe, el
  // navegador ignora el background-image y queda el color solido (fallback).
  const fondoCard = theme
    ? {
        backgroundColor: theme.colores.bg,
        ...(theme.imagenFondo
          ? { backgroundImage: `url(${theme.imagenFondo})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : {}),
        // La caja del theme es mas alta que el contenido: heredar el `min-height` del
        // contenedor para que el interior la llene y `justify-between` reparta el aire
        // entre header / sellos / footer. La rama historica ya lo hacia; sin esto la
        // tarjeta con theme quedaba del alto del contenido (no llenaba la caja).
        minHeight: 'inherit' as const,
        borderColor: theme.colores.brandDark,
        color: theme.colores.text,
        // Fuente de cuerpo del tenant (item c: --font-body via next/font).
        fontFamily: 'var(--font-body), system-ui, sans-serif',
      }
    : { minHeight: 'inherit' as const }

  // Capa de color de marca sobre la imagen de fondo: 70% arriba a 85% abajo.
  // Es lo que GARANTIZA el contraste >= 4.5:1 del texto blanco sobre la foto
  // (incluso si la imagen tiene zonas claras/blancas): con brandDark #7A0A1C al
  // 70% un pixel blanco compuesto queda en ~5.3:1 con blanco; al 85%, ~8:1.
  const overlayTheme = theme ? hexARgba(theme.colores.brandDark, 0.85) : null
  const overlayTop = theme ? hexARgba(theme.colores.brandDark, 0.7) : null

  return (
    <motion.div
      data-slot="tarjeta-sellos"
      data-tamano={tamaño}
      data-estado={estadoReal}
      data-themed={themed ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      // El contenedor se anuncia como una imagen (resumen) y ademas cada sello
      // lleva su propio aria-label.
      role="img"
      aria-label={etiquetaContenedor}
      onClick={onClick}
      initial={animar ? 'oculto' : false}
      animate="visible"
      variants={variantesContenedor}
      className={cn('relative', config.caja, onClick && 'cursor-pointer', className)}
      style={{
        // La tarjeta CON theme (tamano full) es mas grande que la historica: hasta 400px
        // de ancho (en mobile manda el ancho de la pantalla) y 580px de alto minimo. Va
        // en `style` y no en el preset `full` porque ese preset lo comparte la tarjeta
        // historica (bar-la-esquina), que no debe cambiar.
        ...(theme && tamaño === 'full' ? { maxWidth: '400px', minHeight: '580px' } : {}),
        ['--color-primary' as string]: colorPrimario,
        ['--color-secondary' as string]: colorSecundario,
        ...(theme
          ? {
              ['--theme-bg' as string]: theme.colores.bg,
              ['--theme-accent' as string]: theme.colores.accent,
              ['--theme-brand-dark' as string]: theme.colores.brandDark,
              ['--theme-text' as string]: theme.colores.text,
              ['--theme-text-muted' as string]: theme.colores.textMuted,
            }
          : {}),
      }}
    >
      {/* Borde animado cuando la tarjeta esta completa */}
      {completa && animar ? (
        <motion.span
          aria-hidden="true"
          data-slot="tarjeta-borde-animado"
          className="pointer-events-none absolute -inset-[2px] rounded-[1.6rem]"
          style={{
            background: theme
              ? `linear-gradient(135deg, ${theme.colores.accent}, ${theme.colores.brandDark})`
              : `linear-gradient(135deg, ${colorPrimario}, ${colorSecundario})`,
          }}
          animate={{ opacity: [0.35, 0.95, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}

      <div
        className={cn(
          'relative flex h-full w-full flex-col justify-between overflow-hidden rounded-3xl',
          themed ? 'border' : glass ? 'border border-white/20 bg-white/10 backdrop-blur-xl' : 'border border-border bg-card',
          config.padding,
        )}
        style={fondoCard}
      >
        {theme && overlayTheme && overlayTop ? (
          <span
            aria-hidden="true"
            data-slot="tarjeta-overlay-theme"
            className="pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(180deg, ${overlayTop}, ${overlayTheme})` }}
          />
        ) : null}

        {animar && etapa >= 2 ? (
          <Confeti
            cantidad={completa && etapa >= 5 ? 40 : 20}
            global={completa && etapa >= 5}
            colorPrimario={theme ? theme.colores.accent : colorPrimario}
            colorSecundario={theme ? theme.colores.brandDark : colorSecundario}
          />
        ) : null}

        <header className={cn('flex items-center gap-3', theme && 'relative')}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={nombreNegocio} width={44} height={44} className={cn('shrink-0 rounded-2xl object-cover', tamaño === 'full' ? 'size-12' : 'size-9')} />
          ) : theme ? (
            // Rama CON theme: un CIRCULO de 52px arriba a la IZQUIERDA, con el fondo
            // accent del theme y el icono del local adentro (la imagen, recortada
            // redonda). Si la imagen no carga (ni la del slug ni la generica), cae al
            // avatar con la inicial del negocio para no dejar un hueco vacio.
            <span
              aria-hidden="true"
              className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full', tamaño === 'full' ? 'size-[52px]' : 'size-9')}
              style={{ backgroundColor: theme.colores.accent }}
            >
              <IconoEsquina
                slug={slugTenant ?? ''}
                className={cn('rounded-full object-cover', tamaño === 'full' ? 'size-11' : 'size-7')}
                fallback={
                  <span
                    className={cn('flex size-full items-center justify-center rounded-full font-bold', tamaño === 'full' ? 'text-2xl' : 'text-sm')}
                    style={{ color: theme.colores.brandDark }}
                  >
                    {nombreNegocio.slice(0, 1).toUpperCase()}
                  </span>
                }
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={cn('flex shrink-0 items-center justify-center rounded-2xl font-bold text-white', tamaño === 'full' ? 'size-12 text-lg' : 'size-9 text-sm')}
              style={{ backgroundColor: colorPrimario }}
            >
              {nombreNegocio.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            {saludo ? (
              theme ? (
                <p className={cn('truncate font-semibold', config.texto)} style={{ color: theme.colores.textMuted }}>{saludo}</p>
              ) : (
                <p className={cn('truncate font-semibold text-white', config.texto)}>{saludo}</p>
              )
            ) : null}
            {theme ? (
              <p
                className={cn('truncate font-bold', config.titulo)}
                style={{ color: theme.colores.text, fontFamily: 'var(--font-display), system-ui, sans-serif' }}
              >
                {nombreNegocio}
              </p>
            ) : (
              <p className={cn('truncate font-bold text-white', config.titulo)}>{nombreNegocio}</p>
            )}
          </div>
          {theme ? (
            // Rama CON theme: la CORONA (tarjeta completa) sigue a la DERECHA; el
            // icono del local ahora vive a la IZQUIERDA del header (ver arriba). El
            // grupo va EN FLUJO (ml-auto), asi nunca tapa nombre, sellos ni el banner.
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {completa ? (
                <Crown aria-hidden="true" className={cn('shrink-0', config.icono)} style={{ color: theme.colores.accent }} />
              ) : null}
            </span>
          ) : completa ? (
            <Crown aria-hidden="true" className={cn('ml-auto shrink-0 text-white', config.icono)} />
          ) : null}
        </header>

        <motion.div
          className={cn('my-4 grid justify-items-center gap-2', theme && 'relative')}
          // Con theme, el grid va a 3 COLUMNAS: 7 sellos + 1 slot de premio (8) reparten
          // 3+3+2, que deja los vacios mejor distribuidos que las 5 columnas (4+4 / 5+3).
          // La rama historica conserva su `config.columnas` intacto (regresion de bar-la-esquina).
          style={{ gridTemplateColumns: `repeat(${Math.min(theme ? 3 : config.columnas, total)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: total }, (_, i) => (
            <Sello
              key={i}
              indice={i}
              meta={total}
              // El ultimo lugar es el premio: se llena recien cuando la
              // tarjeta esta completa, pero el icono ya es el regalo.
              lleno={i === total - 1 ? llenos >= total : i < llenos}
              esPremio={i === total - 1}
              esUltimoNuevo={animar && etapa >= 1 && i === llenos - 1}
              pulsar={animar && estadoReal === 'casi' && i === total - 1 && etapa < 2}
              config={config}
              colorPrimario={colorPrimario}
              theme={theme}
            />
          ))}
        </motion.div>

        <footer className={cn('space-y-2', theme && 'relative')}>
          <div
            className={cn('h-2 w-full overflow-hidden rounded-full', !theme && 'bg-white/20')}
            style={theme ? { backgroundColor: theme.colores.brandDark } : undefined}
          >
            <motion.div
              data-slot="tarjeta-progreso"
              className="h-full rounded-full"
              style={{ backgroundColor: theme ? theme.colores.accent : colorPrimario }}
              initial={false}
              animate={{ width: `${porcentaje}%` }}
              // Barra: transicion suave cuando anima; instantanea con reduced motion.
              transition={animar ? { duration: theme ? 0.6 : 0.5, ease: 'easeOut' } : { duration: 0 }}
            />
          </div>

          {theme ? (
            <p className={cn('font-medium', config.texto)} style={{ color: theme.colores.text }}>
              {mensajeThemed}
            </p>
          ) : (
            <p className={cn('font-medium text-white/90', config.texto)}>
              {completa ? etiquetaContenedor.split('. ')[1] ?? '' : `Llevás ${llenos} de ${total} ${tipo === 'PUNTOS' ? 'puntos' : 'visitas'}`}
            </p>
          )}

          {theme ? (
            mostrarPremio ? (
              <motion.p
                data-slot="tarjeta-motivacional"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0.4 : 0.3 }}
                className={cn('font-semibold', config.texto)}
                style={{ color: theme.colores.accent }}
              >
                {mensajeThemed}
              </motion.p>
            ) : null
          ) : animar && etapa >= 4 ? (
            <motion.p
              data-slot="tarjeta-motivacional"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={cn('font-semibold text-white', config.texto)}
            >
              {textoMotivacional(estadoReal, faltan, premioTexto, tipo)}
            </motion.p>
          ) : (
            <p className={cn('text-white/80', config.texto)}>{textoMotivacional(estadoReal, faltan, premioTexto, tipo)}</p>
          )}

          {mostrarUltimaVisita && ultimaVisita ? (
            theme ? (
              <p className={cn('flex items-center gap-1', config.texto)} style={{ color: theme.colores.textMuted }}>
                <Clock aria-hidden="true" className="size-3.5" />
                Última visita: {haceCuanto(ultimaVisita)}
              </p>
            ) : (
              <p className={cn('flex items-center gap-1 text-white/70', config.texto)}>
                <Clock aria-hidden="true" className="size-3.5" />
                Última visita: {haceCuanto(ultimaVisita)}
              </p>
            )
          ) : null}
        </footer>

        {/* Fase 5: banner de premio. Con reduced motion aparece solo con fade. */}
        {mostrarPremio ? (
          <motion.div
            data-slot="tarjeta-banner-premio"
            initial={reducedMotion ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { scale: [0.8, 1.06, 1], opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={cn('mt-3 flex items-center gap-2 rounded-2xl px-4 py-3 font-semibold', theme && 'relative', !theme && 'text-white')}
            style={
              theme
                ? { background: `linear-gradient(135deg, ${theme.colores.accent}, ${theme.colores.brandDark})`, color: theme.colores.text }
                : { background: `linear-gradient(135deg, ${colorPrimario}, ${colorSecundario})` }
            }
          >
            <Gift aria-hidden="true" className="size-5" />
            ¡Completaste tu tarjeta! Mostrale esta pantalla al personal
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  )
}

TarjetaSellos.displayName = 'TarjetaSellos'
