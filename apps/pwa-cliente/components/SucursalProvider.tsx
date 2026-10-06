'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import type { SucursalPublica } from '@/types/api'
import { useSucursalStore, type OrigenSucursal } from '@/stores/sucursalStore'
import { useClienteStore } from '@/stores/clienteStore'
import { useBrandingStore } from '@/stores/brandingStore'
import { PARAM_SUCURSAL } from '@/lib/constants'

interface SucursalCtx {
  activa: SucursalPublica | null
  lista: SucursalPublica[]
  origen: OrigenSucursal | null
  /** Cambio explicito (badge o pantalla de seleccion). */
  cambiar: (sucursal: SucursalPublica) => void
  hayVarias: boolean
}

const Ctx = React.createContext<SucursalCtx | null>(null)

export function useSucursalCtx(): SucursalCtx {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error('useSucursalCtx tiene que usarse dentro de <SucursalProvider>')
  return ctx
}

/**
 * Resuelve la sucursal activa con las 4 fuentes, EN ORDEN:
 *   1. ?sucursal=<slug>  (el QR fisico lo puede traer)
 *   2. localStorage      (ultima eleccion del usuario, por negocio)
 *   3. "jwt"             (la tarjeta del cliente: es lo que codifica el claim
 *                         sucursalId con modoClientes = POR_SUCURSAL)
 *   4. esPrincipal
 */
export function SucursalProvider({ children }: { children: React.ReactNode }) {
  // El query se lee de window.location dentro del efecto y NO con
  // useSearchParams(): ese hook obliga a un boundary de Suspense, y con el
  // fallback el HTML prerenderizado sale SIN los children (pantalla vacia en el
  // primer render). usePathname si se usa para re-evaluar al navegar.
  const pathname = usePathname()
  const negocio = useBrandingStore((s) => s.negocio)
  const tarjetas = useClienteStore((s) => s.tarjetas)

  const activa = useSucursalStore((s) => s.activa)
  const listaStore = useSucursalStore((s) => s.lista)
  const origen = useSucursalStore((s) => s.origen)
  const eleccion = useSucursalStore((s) => s.eleccion)
  const fijarLista = useSucursalStore((s) => s.fijarLista)
  const activar = useSucursalStore((s) => s.activar)
  const elegir = useSucursalStore((s) => s.elegir)

  React.useEffect(() => {
    void useSucursalStore.persist.rehydrate()
  }, [])

  const lista = negocio?.sucursales ?? listaStore

  React.useEffect(() => {
    if (negocio?.sucursales?.length) fijarLista(negocio.sucursales)
  }, [negocio?.sucursales, fijarLista])

  React.useEffect(() => {
    if (!negocio || !lista.length) return

    const buscar = (slug: string | null | undefined) =>
      slug ? (lista.find((s) => s.slug === slug) ?? null) : null

    // 1) query (?sucursal=norte: lo puede traer el QR fisico)
    const porQuery = buscar(new URLSearchParams(window.location.search).get(PARAM_SUCURSAL))
    if (porQuery) {
      activar(porQuery, 'query')
      return
    }

    // 2) storage (solo si la eleccion es del negocio actual)
    if (eleccion && eleccion.negocioSlug === negocio.slug) {
      const porStorage = buscar(eleccion.sucursalSlug)
      if (porStorage) {
        activar(porStorage, 'storage')
        return
      }
    }

    // 3) la tarjeta del cliente mas reciente: es la sucursal que el backend
    //    resuelve con el claim del JWT cuando modoClientes = POR_SUCURSAL
    if (negocio.modoClientes === 'POR_SUCURSAL' && tarjetas.length) {
      const ordenadas = [...tarjetas].sort(
        (a, b) => new Date(b.ultimaVisita ?? 0).getTime() - new Date(a.ultimaVisita ?? 0).getTime(),
      )
      const porTarjeta = buscar(lista.find((s) => s.id === ordenadas[0]?.sucursalId)?.slug)
      if (porTarjeta) {
        activar(porTarjeta, 'jwt')
        return
      }
    }

    // 4) principal (el backend tambien cae aca)
    const principal = lista.find((s) => s.esPrincipal) ?? lista[0] ?? null
    if (principal) activar(principal, 'principal')
  }, [negocio, lista, eleccion, tarjetas, pathname, activar])

  const valor = React.useMemo<SucursalCtx>(
    () => ({
      activa,
      lista,
      origen,
      hayVarias: lista.length > 1,
      cambiar: (sucursal: SucursalPublica) => {
        if (negocio) elegir(negocio.slug, sucursal)
      },
    }),
    [activa, lista, origen, negocio, elegir],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}
