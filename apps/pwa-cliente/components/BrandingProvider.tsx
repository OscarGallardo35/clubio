'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import type { ConfiguracionPublica, NegocioPublico } from '@/types/api'
import { useBrandingStore } from '@/stores/brandingStore'
import { tenantDelPath } from '@/lib/tenant'
import { api } from '@/lib/api'
import { COLOR_PRIMARIO_DEFECTO, COLOR_SECUNDARIO_DEFECTO, RUTAS_INMERSIVAS } from '@/lib/constants'

export type ModoBranding = 'inmersivo' | 'funcional'

/** Convierte #rrggbb a la tripleta HSL que espera el tema shadcn ("0 84% 60%"). */
export function hexAHslTriple(hex: string | null | undefined): string | null {
  if (!hex) return null
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null

  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let s = 0
  let hue = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) hue = ((b - r) / d + 2) / 6
    else hue = ((r - g) / d + 4) / 6
  }

  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

interface BrandingCtx {
  negocio: NegocioPublico | null
  configuracion: ConfiguracionPublica | null
  features: string[]
  modo: ModoBranding
  cargando: boolean
  error: string | null
  colorPrimario: string
  colorSecundario: string
  /** Gating visual: el backend ya bloquea, esto solo esconde lo que no aplica. */
  tieneFeature: (feature: string) => boolean
}

const Ctx = React.createContext<BrandingCtx | null>(null)

export function useBrandingCtx(): BrandingCtx {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error('useBrandingCtx tiene que usarse dentro de <BrandingProvider>')
  return ctx
}

/** El modo lo decide la ruta; el prop lo puede forzar. */
export function modoDeRuta(pathname: string | null): ModoBranding {
  if (!pathname) return 'funcional'
  return RUTAS_INMERSIVAS.some((r) => pathname.endsWith(r)) ? 'inmersivo' : 'funcional'
}

export interface BrandingProviderProps {
  children: React.ReactNode
  /** Viene del Server Component del layout: evita el flash de "sin color". */
  negocioInicial?: NegocioPublico | null | undefined
  /** Fuerza el modo; si no, se deriva de la ruta. */
  modo?: ModoBranding | undefined
  tenant?: string | undefined
}

export function BrandingProvider({ children, negocioInicial, modo, tenant }: BrandingProviderProps) {
  const pathname = usePathname()
  const negocio = useBrandingStore((s) => s.negocio)
  const cargando = useBrandingStore((s) => s.cargando)
  const error = useBrandingStore((s) => s.error)
  const cargar = useBrandingStore((s) => s.cargar)
  const fijarInicial = useBrandingStore((s) => s.fijarInicial)

  const modoReal = modo ?? modoDeRuta(pathname)

  // 1) rehidratar lo persistido (skipHydration) y 2) si no vino del servidor,
  //    pedir el negocio. El tenant sale del layout o del primer segmento.
  React.useEffect(() => {
    void useBrandingStore.persist.rehydrate()
  }, [])

  React.useEffect(() => {
    if (negocioInicial) {
      fijarInicial(negocioInicial)
      return
    }
    const slug = tenant ?? tenantDelPath(pathname)
    if (slug && negocio?.slug !== slug) void cargar(slug)
  }, [negocioInicial, tenant, pathname, negocio?.slug, fijarInicial, cargar])

  // El cliente se resuelve por cookie: el tenant lo tiene que mandar el header.
  React.useEffect(() => {
    const slug = negocio?.slug ?? tenant ?? tenantDelPath(pathname)
    if (slug) api.setTenant(slug)
  }, [negocio?.slug, tenant, pathname])

  const colorPrimario = negocio?.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const colorSecundario = negocio?.colorSecundario || COLOR_SECUNDARIO_DEFECTO

  // theme-color: la barra del navegador toma el color del local. En iOS ademas
  // el status bar translucido (eso va estatico en el metadata del layout).
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', colorPrimario)
  }, [colorPrimario])

  // Titulo con el nombre del negocio (el metadata del layout es estatico).
  React.useEffect(() => {
    if (typeof document === 'undefined' || !negocio?.nombre) return
    document.title = `${negocio.nombre} — Club`
  }, [negocio?.nombre])

  const features = negocio?.features ?? []
  const valor = React.useMemo<BrandingCtx>(
    () => ({
      negocio,
      configuracion: negocio?.configuracion ?? null,
      features,
      modo: modoReal,
      cargando,
      error,
      colorPrimario,
      colorSecundario,
      tieneFeature: (feature: string) => features.includes(feature),
    }),
    [negocio, features, modoReal, cargando, error, colorPrimario, colorSecundario],
  )

  const hslPrimario = hexAHslTriple(colorPrimario)
  const hslSecundario = hexAHslTriple(colorSecundario)

  return (
    <Ctx.Provider value={valor}>
      <div
        data-modo={modoReal}
        data-negocio={negocio?.slug ?? undefined}
        // Doble juego de variables a proposito:
        //  - --primary/--secondary como tripleta HSL para el sistema shadcn
        //  - --color-primary/--color-secondary con el HEX para gradientes y framer
        style={{
          ...(hslPrimario ? { ['--primary' as string]: hslPrimario, ['--ring' as string]: hslPrimario } : {}),
          ...(hslSecundario ? { ['--secondary' as string]: hslSecundario } : {}),
          ['--color-primary' as string]: colorPrimario,
          ['--color-secondary' as string]: colorSecundario,
        }}
        className={
          modoReal === 'inmersivo'
            ? 'min-h-dvh bg-[linear-gradient(160deg,var(--color-primary),var(--color-secondary))]'
            : 'min-h-dvh bg-background'
        }
      >
        {children}
      </div>
    </Ctx.Provider>
  )
}
