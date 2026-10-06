'use client'

/**
 * Lee la carta de la sucursal activa, con stale-while-revalidate.
 *
 * - Cache fresca (<5 min): devuelve al toque, sin tocar el backend.
 * - Cache vencida: devuelve lo viejo y actualiza en background (el usuario no espera).
 * - Sin cache: fetch bloqueante (la pantalla muestra skeleton).
 *
 * Cambiar de categoria NO pasa por aca: la clave de cache depende solo de negocio+sucursal,
 * asi que navegar el menu no dispara ningun fetch.
 */
import { useCallback, useEffect, useRef } from 'react'
import { cartaApi } from '../lib/api'
import { cartaDeCache } from '../lib/carta-cache'
import { useCartaStore } from '../stores/cartaStore'
import type { CartaPublica } from '../types/api'

export interface UsoCarta {
  carta: CartaPublica | null
  guardadoEn: number | null
  /** No hay nada para mostrar todavia (skeleton). */
  cargando: boolean
  /** Se esta mostrando algo viejo mientras se actualiza. */
  actualizando: boolean
  /** Aviso no bloqueante (ej: no se pudo actualizar, se muestra lo guardado). */
  aviso: string | null
  refetch: () => void
  descartarAviso: () => void
}

export function useCarta(negocioSlug: string, sucursalSlug: string | null): UsoCarta {
  const despachar = useCartaStore((s) => s.despachar)
  const estado = useCartaStore()
  const enVuelo = useRef<string | null>(null)

  const traer = useCallback(
    async (clave: string) => {
      if (enVuelo.current === clave) return
      enVuelo.current = clave
      try {
        const datos = await cartaApi.publica(sucursalSlug)
        despachar({ tipo: 'FETCH_OK', clave, datos, ahora: Date.now() })
      } catch {
        // El reducer NO pisa lo que habia: si hay datos viejos se siguen mostrando.
        despachar({ tipo: 'FETCH_ERROR', clave })
      } finally {
        enVuelo.current = null
      }
    },
    [despachar, sucursalSlug],
  )

  // 1) Al montar o cambiar de negocio/sucursal: resolver que hay en cache para la clave nueva.
  useEffect(() => {
    despachar({ tipo: 'SELECCIONAR', negocioSlug, sucursalSlug, ahora: Date.now() })
  }, [despachar, negocioSlug, sucursalSlug])

  // 2) Si el plan dice que hay que ir al backend (vencida o manual), se va. El guard de
  //    `enVuelo` evita el pedido duplicado cuando los dos efectos coinciden.
  useEffect(() => {
    if (!estado.refetchPendiente || !estado.claveActiva) return
    void traer(estado.claveActiva)
  }, [estado.refetchPendiente, estado.claveActiva, traer])

  const entrada = cartaDeCache(estado, estado.claveActiva)
  return {
    carta: entrada?.datos ?? null,
    guardadoEn: entrada?.guardadoEn ?? null,
    cargando: estado.cargando,
    actualizando: estado.refetchPendiente,
    aviso: estado.aviso,
    refetch: useCallback(() => despachar({ tipo: 'REFETCH_MANUAL' }), [despachar]),
    descartarAviso: useCallback(() => despachar({ tipo: 'DESCARTAR_AVISO' }), [despachar]),
  }
}
