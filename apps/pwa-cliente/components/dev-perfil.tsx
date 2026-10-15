'use client'

/**
 * Harness de DESARROLLO del perfilado progresivo (/dev/perfil).
 *
 * Monta el MISMO componente que va en produccion (`PerfilamientoGate`), con un cliente y un
 * negocio FALSOS sembrados a mano: sin esto habria que juntar 3 visitas reales para poder mirar el
 * cartel. Sirve para lo que las pruebas unitarias no ven: geometria a 375px, que el boton Guardar
 * entre sin scroll, y los dos textos (cumple y genero) uno al lado del otro.
 *
 * El PATCH pega al backend real: si no esta levantado, el cartel muestra su error de red (que es
 * justamente lo que hay que ver en ese caso).
 *
 * El caso se elige con `?caso=cumple|genero|completo|rechazado|sin-config|cooldown`. El query se lee
 * de `window.location` en un efecto (mismo camino que /dev/flujo: no arrastra Suspense ni ataduras
 * de prerender).
 */
import * as React from 'react'
import { BrandingProvider } from '@/components/BrandingProvider'
import { PerfilamientoGate } from '@/components/perfil/PerfilamientoGate'
import { useClienteStore } from '@/stores/clienteStore'
import { limpiarPerfilamientoLocal, marcarCumpleRespondido, marcarOmitido } from '@/lib/perfilamiento-storage'
import type { ClienteBasico, NegocioPublico } from '@/types/api'

const SLUG = 'dev-perfil'

const NEGOCIO_FALSO: NegocioPublico = {
  id: 'neg-dev',
  nombre: 'Bar La Esquina (dev)',
  slug: SLUG,
  plan: 'PRO',
  modoClientes: 'GLOBAL',
  activo: true,
  colorPrimario: '#E63946',
  colorSecundario: '#F77F00',
  configuracion: {
    sellosParaPremio: 10,
    premioTexto: 'Café gratis',
    menuActivo: true,
    mostrarResenaPostVisita: false,
    perfilDesdeVisita: 3,
  },
  sucursales: [],
  features: ['menu', 'push'],
}

const CASOS = ['cumple', 'genero', 'completo', 'rechazado', 'sin-config', 'cooldown'] as const
type Caso = (typeof CASOS)[number]

interface Escenario {
  cliente: ClienteBasico
  /** undefined = el backend todavia no manda el campo (caso 'sin-config'). */
  perfilDesdeVisita?: number
}

function escenario(caso: Caso): Escenario {
  const base: ClienteBasico = { id: 'cli-dev', nombre: 'Ana', telefono: 'telefono-de-dev' }
  const conPerfil = { perfilDesdeVisita: 3 }
  switch (caso) {
    case 'genero':
      return {
        cliente: { ...base, totalVisitas: 6, fechaNacimiento: '1990-05-03T00:00:00.000Z', genero: null, perfiladoRechazado: false },
        ...conPerfil,
      }
    case 'completo':
      return {
        cliente: { ...base, totalVisitas: 9, fechaNacimiento: '1990-05-03T00:00:00.000Z', genero: 'FEMENINO', perfiladoRechazado: false },
        ...conPerfil,
      }
    case 'rechazado':
      return {
        cliente: { ...base, totalVisitas: 40, fechaNacimiento: null, genero: null, perfiladoRechazado: true },
        ...conPerfil,
      }
    case 'sin-config':
      // Sin `perfilDesdeVisita`: es el backend viejo. La PWA no tiene que preguntar nada.
      return { cliente: { ...base, totalVisitas: 9, fechaNacimiento: null, genero: null, perfiladoRechazado: false } }
    case 'cooldown':
      return {
        cliente: { ...base, totalVisitas: 4, fechaNacimiento: null, genero: null, perfiladoRechazado: false },
        ...conPerfil,
      }
    case 'cumple':
    default:
      return {
        cliente: { ...base, totalVisitas: 3, fechaNacimiento: null, genero: null, perfiladoRechazado: false },
        ...conPerfil,
      }
  }
}

export function DevPerfil() {
  const [caso, setCaso] = React.useState<Caso>('cumple')
  const [negocio, setNegocio] = React.useState<NegocioPublico>(NEGOCIO_FALSO)
  /**
   * El gate se monta RECIEN despues de sembrar. No es un detalle del harness: los efectos del
   * padre corren DESPUES de los del hijo, asi que si el gate leyera localStorage en su primer
   * efecto, todavia estaria viendo el estado anterior (y el caso 'cooldown' mostraria el cartel).
   */
  const [sembrado, setSembrado] = React.useState(false)

  // Query param (revision visual sin navegar): se lee del navegador, no del servidor.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('caso')
    if (q && (CASOS as readonly string[]).includes(q)) setCaso(q as Caso)
  }, [])

  React.useEffect(() => {
    const { cliente, perfilDesdeVisita } = escenario(caso)
    const configuracion = { ...NEGOCIO_FALSO.configuracion }
    if (typeof perfilDesdeVisita === 'number') configuracion.perfilDesdeVisita = perfilDesdeVisita
    else delete configuracion.perfilDesdeVisita

    setNegocio({ ...NEGOCIO_FALSO, configuracion })
    useClienteStore.setState({ cliente, autenticado: true, cargando: false })

    limpiarPerfilamientoLocal(SLUG)
    if (caso === 'cooldown') marcarOmitido(SLUG)
    if (caso === 'genero') marcarCumpleRespondido(SLUG, Date.now())
    setSembrado(true)
  }, [caso])

  return (
    <BrandingProvider negocioInicial={negocio} tenant={SLUG} modo="funcional">
      <div className="min-h-dvh bg-background p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          dev · perfilado progresivo (caso: {caso})
        </p>
        <nav className="mt-2 flex flex-wrap gap-2 text-sm">
          {CASOS.map((c) => (
            <a key={c} href={`/dev/perfil?caso=${c}`} className="rounded-lg border border-border px-3 py-2">
              {c}
            </a>
          ))}
        </nav>
        {sembrado ? <PerfilamientoGate /> : null}
      </div>
    </BrandingProvider>
  )
}
