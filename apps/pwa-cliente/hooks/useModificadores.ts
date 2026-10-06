'use client'

/**
 * Trae los modificadores de un item con el cache de por medio. Es DELGADO a proposito: la
 * decision de ir o no al backend la toma `planDeFetchMods`, y el precio entra normalizado por
 * `normalizarModificadores` (aca no se convierte nada a mano).
 */
import { useCallback, useEffect, useRef } from 'react'
import { modificadoresApi } from '../lib/api'
import { modificadoresDeCache, normalizarModificadores } from '../lib/modificadores-cache'
import { useModificadoresStore } from '../stores/modificadoresStore'
import type { ModificadoresDeItem } from '../lib/modificadores-cache'

export interface UsoModificadores {
  modificadores: ModificadoresDeItem | null
  /** No hay nada para mostrar todavia. */
  cargando: boolean
  /** Se esta mostrando lo viejo mientras se actualiza. */
  actualizando: boolean
  aviso: string | null
  refetch: () => void
  descartarAviso: () => void
}

export function useModificadores(itemId: string | null): UsoModificadores {
  const despachar = useModificadoresStore((s) => s.despachar)
  const estado = useModificadoresStore()
  const enVuelo = useRef<string | null>(null)
  const idActual = useRef<string | null>(null)
  idActual.current = itemId

  const traer = useCallback(
    async (clave: string) => {
      const id = idActual.current
      if (!id || enVuelo.current === clave) return
      enVuelo.current = clave
      try {
        const crudo = await modificadoresApi.porItem(id)
        // El precioExtra viene como string desde el backend: se normaliza ACA, al entrar.
        despachar({ tipo: 'FETCH_OK', clave, datos: normalizarModificadores(crudo), ahora: Date.now() })
      } catch {
        despachar({ tipo: 'FETCH_ERROR', clave })
      } finally {
        enVuelo.current = null
      }
    },
    [despachar],
  )

  useEffect(() => {
    if (!itemId) return
    despachar({ tipo: 'SELECCIONAR', itemId, ahora: Date.now() })
  }, [itemId, despachar])

  useEffect(() => {
    if (!estado.refetchPendiente || !estado.claveActiva) return
    void traer(estado.claveActiva)
  }, [estado.refetchPendiente, estado.claveActiva, traer])

  const entrada = modificadoresDeCache(estado, estado.claveActiva)
  return {
    modificadores: entrada?.datos ?? null,
    cargando: estado.cargando,
    actualizando: estado.refetchPendiente,
    aviso: estado.aviso,
    refetch: useCallback(() => despachar({ tipo: 'REFETCH_MANUAL' }), [despachar]),
    descartarAviso: useCallback(() => despachar({ tipo: 'DESCARTAR_AVISO' }), [despachar]),
  }
}
