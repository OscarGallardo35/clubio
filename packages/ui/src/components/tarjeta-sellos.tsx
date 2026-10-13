'use client'

import * as React from 'react'
import { motion, useMotionValue, useSpring, type MotionValue, type Variants } from 'framer-motion'
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

/**
 * La estrella del sello (rama CON theme): al doble del icono historico.
 *
 * Va aparte de `CONFIG.icono` a proposito: esa clave la consume tambien la rama historica
 * (bar-la-esquina), que no se puede tocar. El `?? config.icono` cubre los tamaños sin entrada.
 */
const ICONO_SELLO_THEME: Partial<Record<TamanoTarjeta, string>> = {
  full: 'size-12', // 24px -> 48px: llena el sello (el path del SVG ya trae margen propio)
  medium: 'size-10',
  small: 'size-7',
}
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

/**
 * `hexARgba` con fallback: si el color del theme NO es hex (cualquier color CSS
 * valido lo es para el tipo), devuelve el color tal cual. Asi el reverso nunca
 * queda con un `rgba(null,...)` invalido.
 */
export function conAlpha(color: string, alpha: number): string {
  return hexARgba(color, alpha) ?? color
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
  tamaño,
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
  /** Solo lo usa la rama con theme (la estrella agrandada sale de ICONO_SELLO_THEME). */
  tamaño: TamanoTarjeta
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
            className={ICONO_SELLO_THEME[tamaño] ?? config.icono}
            style={{ transform: `rotate(${rot}deg)` }}
            fill={theme.colores.accent}
            stroke={theme.colores.brandDark}
            strokeWidth={1.6}
            strokeLinejoin="round"
          >
            <path d="M12 2.6l2.72 5.5 6.08.88-4.4 4.28 1.04 6.05L12 16.9l-5.44 2.41 1.04-6.05-4.4-4.28 6.08-.88z" />
          </svg>
        ) : (
          <Circle aria-hidden="true" className={ICONO_SELLO_THEME[tamaño] ?? config.icono} />
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

/**
 * Envoltura del giro 3D (solo CON theme). El contenedor es LOCAL: aplica
 * `perspective` aca (y no en un ancestro compartido) y NO tiene descendientes
 * `position: fixed`, asi que la barra inferior del cliente no se mueve. El tilt y
 * el brillo van `pointer-events-none`.
 *
 * Cuando NO hay theme devuelve los hijos tal cual (una sola cara): el DOM de la
 * tarjeta historica (bar-la-esquina) queda IDENTICO.
 */
function GiroTarjeta({
  theme,
  reducedMotion,
  tiltX,
  tiltY,
  giro,
  volteada,
  alMover,
  alSalir,
  brilloRef,
  children,
}: {
  theme: TemaTarjeta | null
  reducedMotion: boolean
  tiltX: MotionValue<number>
  tiltY: MotionValue<number>
  giro: MotionValue<number>
  volteada: boolean
  alMover: React.PointerEventHandler<HTMLDivElement>
  alSalir: () => void
  brilloRef: React.RefObject<HTMLDivElement>
  children: React.ReactNode
}) {
  if (!theme) return <>{children}</>
  return (
    <div
      className="relative w-full"
      style={{ perspective: '1400px', minHeight: 'inherit' }}
      onPointerMove={alMover}
      onPointerLeave={alSalir}
      onPointerUp={alSalir}
      onPointerCancel={alSalir}
    >
      <motion.div
        className="relative w-full"
        // preserve-3d en cada nivel para que el rotateY del giro NO se aplane.
        style={{ transformStyle: 'preserve-3d', minHeight: 'inherit', rotateX: tiltX, rotateY: tiltY }}
      >
        <motion.div
          data-slot="tarjeta-giro"
          data-cara={volteada ? 'reverso' : 'frente'}
          className="relative grid w-full"
          style={{ transformStyle: 'preserve-3d', minHeight: 'inherit', gridTemplateColumns: 'minmax(0, 1fr)', rotateY: giro }}
        >
          {children}
        </motion.div>
      </motion.div>
      {/* Capa de brillo que sigue al puntero (pointer-events-none, no bloquea nada). */}
      {!reducedMotion ? (
        <div
          ref={brilloRef}
          aria-hidden="true"
          data-slot="tarjeta-brillo"
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{
            background: `radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), ${conAlpha(theme.colores.text, 0.28)}, transparent 45%)`,
            opacity: 0,
            transition: 'opacity 320ms ease',
          }}
        />
      ) : null}
    </div>
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

  // --- reverso + giro 3D (SOLO rama con theme) -----------------------------
  // El contenedor del giro es LOCAL y no tiene descendientes `position: fixed`.
  // Meter `transform`/`perspective`/`will-change` en un ANCESTRO de un fixed lo
  // vuelve relativo a ese ancestro: ese fue exactamente el bug que hizo
  // DESAPARECER la barra inferior del staff. Aca no hay ningun fixed adentro, asi
  // que es seguro. Tampoco se deja `will-change` pegado: el transform va directo
  // sobre las caras / springs.
  const [volteada, setVolteada] = React.useState(false)
  const yaGiroAuto = React.useRef(false)
  const giroTimers = React.useRef<ReturnType<typeof setTimeout>[]>([])
  const brilloRef = React.useRef<HTMLDivElement | null>(null)

  // Tilt y giro se manejan con MOTION VALUES (van en `style`, NO en `animate`) para
  // no cortar la propagacion de variantes con la que entran los sellos.
  const tiltX = useMotionValue(0) // rotateX
  const tiltY = useMotionValue(0) // rotateY
  const tiltXSpring = useSpring(tiltX, { stiffness: 220, damping: 20, mass: 0.5 })
  const tiltYSpring = useSpring(tiltY, { stiffness: 220, damping: 20, mass: 0.5 })
  const giroObjetivo = useMotionValue(0)
  const giroAngulo = useSpring(giroObjetivo, { stiffness: 200, damping: 24, mass: 0.7 })

  React.useEffect(() => {
    giroObjetivo.set(!reducedMotion && volteada ? 180 : 0)
  }, [volteada, reducedMotion, giroObjetivo])

  /**
   * Tilt sutil (~3deg por lado) + brillo siguiendo el puntero. NO hace pointer
   * capture ni preventDefault: por eso no pelea con el scroll ni con el gesto de
   * atras del celular. Actualiza motion values y variables CSS directo (sin
   * re-render: en un telefono de gama baja eso importa).
   */
  const alMoverPuntero = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || !themed) return
      const r = e.currentTarget.getBoundingClientRect()
      if (!r.width || !r.height) return
      const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      tiltY.set((nx - 0.5) * -6)
      tiltX.set((ny - 0.5) * 6)
      const brillo = brilloRef.current
      if (brillo) {
        brillo.style.setProperty('--shine-x', `${(nx * 100).toFixed(1)}%`)
        brillo.style.setProperty('--shine-y', `${(ny * 100).toFixed(1)}%`)
        brillo.style.opacity = '1'
      }
    },
    [reducedMotion, themed, tiltX, tiltY],
  )

  const alSalirPuntero = React.useCallback(() => {
    tiltX.set(0)
    tiltY.set(0)
    if (brilloRef.current) brilloRef.current.style.opacity = '0'
  }, [tiltX, tiltY])

  // Giro por toque: funciona SIEMPRE (es interaccion del usuario, no decoracion) y
  // no rompe el onClick existente: lo sigue llamando si el caller lo paso.
  const alTocar = React.useCallback(() => {
    if (themed) setVolteada((v) => !v)
    onClick?.()
  }, [themed, onClick])

  // Icono del header CON theme: escala con el tamano de la tarjeta para que el flujo
  // (medium/small) muestre el MISMO diseno que /tarjeta (full), no un avatar chico.
  // El circulo con el logo va ~40% mas grande (106/90 full, 78/67 medium, 62/50 small)
  // manteniendo la proporcion circulo/imagen; aplica a la tarjeta real y a la de demo.
  const circuloThemed = tamaño === 'full' ? 'size-[106px]' : tamaño === 'medium' ? 'size-[78px]' : 'size-[62px]'
  const iconoThemed = tamaño === 'full' ? 'size-[90px]' : tamaño === 'medium' ? 'size-[67px]' : 'size-[50px]'
  const inicialThemed = tamaño === 'full' ? 'text-4xl' : tamaño === 'medium' ? 'text-2xl' : 'text-xl'

  // Icono del REVERSO (solo theme): mas grande que el del header porque es lo unico
  // que hay en esa cara.
  const circuloReverso = tamaño === 'full' ? 'size-[180px]' : tamaño === 'medium' ? 'size-[120px]' : 'size-[96px]'
  const iconoReverso = tamaño === 'full' ? 'size-[152px]' : tamaño === 'medium' ? 'size-[100px]' : 'size-[80px]'
  const inicialReverso = tamaño === 'full' ? 'text-6xl' : tamaño === 'medium' ? 'text-4xl' : 'text-3xl'

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
      // El giro automatico tambien es NO critico: si el usuario interactua se
      // cancela y la tarjeta vuelve al frente.
      giroTimers.current.forEach(clearTimeout)
      giroTimers.current = []
      setVolteada(false)
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

  // Giro automatico UNA vez cuando se desbloquea el premio: reverso ~1.2s y vuelta.
  // Con reducedMotion NO hay giro automatico (solo el fade del premio, ya existente).
  React.useEffect(() => {
    if (reducedMotion || !themed || !mostrarPremio || yaGiroAuto.current) return
    yaGiroAuto.current = true
    setVolteada(true)
    const t = setTimeout(() => setVolteada(false), 1200)
    giroTimers.current.push(t)
    return () => clearTimeout(t)
  }, [mostrarPremio, reducedMotion, themed])

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

  // --- estilos de las dos caras del giro (solo theme) ---------------------
  // Con reducedMotion NO hay rotacion: las caras se cruzan con un fade (opacity) y
  // el reverso pierde su `rotateY`. Con movimiento, cada cara lleva su
  // `backfaceVisibility: hidden` y el reverso va rotado 180 para no salir espejado.
  const sinMovimiento = reducedMotion
  const caraFrenteStyle: React.CSSProperties = {
    ...fondoCard,
    gridArea: '1 / 1',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    opacity: sinMovimiento ? (volteada ? 0 : 1) : 1,
    transition: sinMovimiento ? 'opacity 320ms ease' : 'none',
  }
  const caraReversoStyle: React.CSSProperties = theme
    ? {
        gridArea: '1 / 1',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: sinMovimiento ? 'none' : 'rotateY(180deg)',
        opacity: sinMovimiento ? (volteada ? 1 : 0) : 1,
        transition: sinMovimiento ? 'opacity 320ms ease' : 'none',
        minHeight: 'inherit',
        borderColor: theme.colores.brandDark,
        color: theme.colores.text,
        // Decoracion (SIN datos): degradado de marca + hairlines diagonales + trama
        // de puntos, todo con los colores del theme. Nada de imagenes.
        backgroundColor: theme.colores.bg,
        backgroundImage: [
          `radial-gradient(130% 110% at 50% -10%, ${conAlpha(theme.colores.accent, 0.4)} 0%, transparent 55%)`,
          `repeating-linear-gradient(45deg, ${conAlpha(theme.colores.text, 0.05)} 0 1px, transparent 1px 10px)`,
          `radial-gradient(${conAlpha(theme.colores.accent, 0.22)} 1.3px, transparent 1.5px)`,
          `linear-gradient(160deg, ${theme.colores.brandDark} 0%, ${theme.colores.bg} 100%)`,
        ].join(', '),
        backgroundSize: 'auto, auto, 16px 16px, auto',
        backgroundRepeat: 'no-repeat, repeat, repeat, no-repeat',
      }
    : {}

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
      // Con theme, el toque hace ademas el giro; sin theme se conserva el onClick de siempre.
      onClick={themed ? alTocar : onClick}
      initial={animar ? 'oculto' : false}
      animate="visible"
      variants={variantesContenedor}
      className={cn('relative', config.caja, (themed || onClick) && 'cursor-pointer', className)}
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

      <GiroTarjeta
        theme={theme}
        reducedMotion={reducedMotion}
        tiltX={tiltXSpring}
        tiltY={tiltYSpring}
        giro={giroAngulo}
        volteada={volteada}
        alMover={alMoverPuntero}
        alSalir={alSalirPuntero}
        brilloRef={brilloRef}
      >
      <div
        className={cn(
          'relative flex h-full w-full flex-col justify-between overflow-hidden rounded-3xl',
          themed ? 'border' : glass ? 'border border-white/20 bg-white/10 backdrop-blur-xl' : 'border border-border bg-card',
          config.padding,
        )}
        // Cara FRENTE: con theme lleva los estilos de cara (gridArea + backface);
        // sin theme queda EXACTAMENTE el estilo de siempre (regresion intacta).
        style={theme ? caraFrenteStyle : fondoCard}
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

        {theme ? (
          // Rama CON theme: el header va CENTRADO. El icono del local (circulo con el
          // fondo accent y la imagen adentro) queda ARRIBA, y DEBAJO el saludo
          // ("Hola, {nombre}") y el nombre del negocio, todo centrado horizontalmente.
          // La corona (tarjeta completa) va ABSOLUTA arriba a la derecha: fuera del
          // flujo no desplaza el bloque centrado ni tapa el saludo ni el nombre.
          <header className="relative flex flex-col items-center gap-2 text-center">
            <span
              aria-hidden="true"
              className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full', circuloThemed)}
              style={{ backgroundColor: theme.colores.accent }}
            >
              <IconoEsquina
                slug={slugTenant ?? ''}
                className={cn('rounded-full object-cover', iconoThemed)}
                fallback={
                  <span
                    className={cn('flex size-full items-center justify-center rounded-full font-bold', inicialThemed)}
                    style={{ color: theme.colores.brandDark }}
                  >
                    {nombreNegocio.slice(0, 1).toUpperCase()}
                  </span>
                }
              />
            </span>
            <div className="min-w-0 max-w-full">
              {saludo ? (
                <p className={cn('truncate font-semibold', config.texto)} style={{ color: theme.colores.textMuted }}>{saludo}</p>
              ) : null}
              <p
                className={cn('truncate font-bold', config.titulo)}
                style={{ color: theme.colores.text, fontFamily: 'var(--font-display), system-ui, sans-serif' }}
              >
                {nombreNegocio}
              </p>
            </div>
            {completa ? (
              <Crown aria-hidden="true" className={cn('absolute right-0 top-0 shrink-0', config.icono)} style={{ color: theme.colores.accent }} />
            ) : null}
          </header>
        ) : (
          // Rama historica (sin theme): intacta. Logo o inicial a la izquierda, saludo +
          // nombre al medio y la corona a la derecha. Es la regresion de bar-la-esquina.
          <header className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={nombreNegocio} width={44} height={44} className={cn('shrink-0 rounded-2xl object-cover', tamaño === 'full' ? 'size-12' : 'size-9')} />
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
              {saludo ? <p className={cn('truncate font-semibold text-white', config.texto)}>{saludo}</p> : null}
              <p className={cn('truncate font-bold text-white', config.titulo)}>{nombreNegocio}</p>
            </div>
            {completa ? <Crown aria-hidden="true" className={cn('ml-auto shrink-0 text-white', config.icono)} /> : null}
          </header>
        )}

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
              tamaño={tamaño}
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

        {/* CARA REVERSO: SIN datos. Solo el icono grande del local + decoracion
            CSS/SVG con los colores del theme (degradado + hairlines + trama de puntos
            + anillos + estrella de marca). Nada de imagenes generadas. */}
        {theme ? (
          <div
            aria-hidden="true"
            data-slot="tarjeta-reverso"
            className={cn(
              'pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl border',
              config.padding,
            )}
            style={caraReversoStyle}
          >
            {/* Anillos concentricos (marco decorativo) */}
            <span className="pointer-events-none absolute inset-7 rounded-full" style={{ border: `1.5px dashed ${conAlpha(theme.colores.accent, 0.35)}` }} />
            <span className="pointer-events-none absolute inset-14 rounded-full" style={{ border: `1px solid ${conAlpha(theme.colores.text, 0.1)}` }} />
            {/* Estrella de marca gigante, muy tenue, detras del icono */}
            <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute size-[78%] opacity-[0.08]" style={{ transform: 'rotate(12deg)' }} fill={theme.colores.accent}>
              <path d="M12 2.6l2.72 5.5 6.08.88-4.4 4.28 1.04 6.05L12 16.9l-5.44 2.41 1.04-6.05-4.4-4.28 6.08-.88z" />
            </svg>
            {/* Icono GRANDE del local: mismo criterio que el header
                (override por slug -> generico -> inicial). */}
            <span
              className={cn('pointer-events-none flex shrink-0 items-center justify-center overflow-hidden rounded-full', circuloReverso)}
              style={{
                backgroundColor: conAlpha(theme.colores.accent, 0.16),
                boxShadow: `0 0 0 2px ${conAlpha(theme.colores.text, 0.14)}, 0 18px 40px rgba(0,0,0,0.25)`,
              }}
            >
              <IconoEsquina
                slug={slugTenant ?? ''}
                className={cn('rounded-full object-cover', iconoReverso)}
                fallback={
                  <span className={cn('flex size-full items-center justify-center rounded-full font-bold', inicialReverso)} style={{ color: theme.colores.text }}>
                    {nombreNegocio.slice(0, 1).toUpperCase()}
                  </span>
                }
              />
            </span>
          </div>
        ) : null}
      </GiroTarjeta>
    </motion.div>
  )
}

TarjetaSellos.displayName = 'TarjetaSellos'
