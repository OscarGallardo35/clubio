'use client'

/**
 * PerfilamientoGate: el unico lugar donde se DECIDE mostrar el cartel y donde se manda el PATCH.
 *
 * Junta las tres fuentes que la maquina necesita:
 *   1. el cliente (/auth/cliente/me, ya en el store: totalVisitas, fechaNacimiento, genero,
 *      perfiladoRechazado, perfiladoOmitidoEn),
 *   2. la config del local (`perfilDesdeVisita` del branding) y
 *   3. los sellos de tiempo del DISPOSITIVO (lib/perfilamiento-storage, por negocio).
 *
 * Es un componente de CLIENTE y no rompe donde no hay branding: usa `useBrandingCtxOpcional`
 * (existe justo para las pantallas de /dev, que montan estas pantallas sin BrandingProvider).
 *
 * Regla de UX que se agrega aca (no en la maquina, que es pura): UNA sola aparicion por sesion de
 * pantalla. Si el cliente guarda o cierra el cartel, no se le muestra otro dato hasta que vuelva
 * a entrar (el genero, por ejemplo, no se pregunta en la misma sesion que el cumpleaños).
 */
import * as React from 'react'
import { clientePerfilApi } from '@/lib/api'
import { RUTAS } from '@/lib/constants'
import {
  clienteDeRespuestaPerfil,
  decidirPerfilamiento,
} from '@/lib/perfilamiento-maquina'
import type { DatoPerfil } from '@/lib/perfilamiento-maquina'
import {
  leerPerfilamientoLocal,
  marcarCumpleRespondido,
  marcarOmitido,
} from '@/lib/perfilamiento-storage'
import { useBrandingCtxOpcional } from '@/components/BrandingProvider'
import { useClienteStore } from '@/stores/clienteStore'
import { PedirDatoSheet } from './PedirDatoSheet'
import type { PerfilamientoLocal } from '@/lib/perfilamiento-storage'
import type { Genero } from '@/types/api'

export interface PerfilamientoGateProps {
  /** false = no evaluar (util para pantallas donde molesta). */
  activo?: boolean
  /** Se llama despues de guardar, para refrescar lo que la pantalla este mostrando. */
  onActualizado?: () => void
}

export function PerfilamientoGate({ activo = true, onActualizado }: PerfilamientoGateProps) {
  const branding = useBrandingCtxOpcional()
  const cliente = useClienteStore((s) => s.cliente)
  const actualizarCliente = useClienteStore((s) => s.actualizarCliente)

  const slug = branding?.negocio?.slug ?? null
  const nombreNegocio = branding?.negocio?.nombre ?? 'el local'
  const perfilDesdeVisita = branding?.configuracion?.perfilDesdeVisita

  // localStorage no existe en el servidor: se lee en un efecto, no en el render.
  const [local, setLocal] = React.useState<PerfilamientoLocal>({})
  const [cerradoEnSesion, setCerradoEnSesion] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!slug) return
    setLocal(leerPerfilamientoLocal(slug))
  }, [slug])

  const decision = React.useMemo(
    () =>
      decidirPerfilamiento({
        totalVisitas: cliente?.totalVisitas,
        perfilDesdeVisita,
        fechaNacimiento: cliente?.fechaNacimiento,
        genero: cliente?.genero,
        perfiladoRechazado: cliente?.perfiladoRechazado,
        ultimaOmitidoEn: cliente?.perfiladoOmitidoEn,
        dismissEnLocalStorage: local.omitidoEn,
        cumpleRespondidoEn: local.cumpleRespondidoEn,
      }),
    [cliente, perfilDesdeVisita, local],
  )

  const dato: DatoPerfil | null = decision.mostrar ? decision.dato : null
  const abierto = Boolean(activo && cliente && slug && dato && !cerradoEnSesion)

  const guardar = React.useCallback(
    async (datos: { fechaNacimiento: string } | { genero: Genero }) => {
      if (!slug) return
      setGuardando(true)
      setError(null)
      try {
        const respuesta = await clientePerfilApi.guardar(datos)
        const actualizado = clienteDeRespuestaPerfil(respuesta)
        if (actualizado) {
          // El backend es la fuente de verdad: se usa lo que devolvio, no lo que mandamos.
          actualizarCliente(actualizado)
        } else {
          // Respuesta con forma desconocida: se refleja lo mandado para no volver a preguntar.
          actualizarCliente(datos)
        }
        if ('fechaNacimiento' in datos) setLocal(marcarCumpleRespondido(slug))
        setCerradoEnSesion(true)
        onActualizado?.()
      } catch {
        setError('No pudimos guardarlo. Probá de nuevo en un rato.')
      } finally {
        setGuardando(false)
      }
    },
    [slug, actualizarCliente, onActualizado],
  )

  const omitir = React.useCallback(() => {
    if (slug) setLocal(marcarOmitido(slug))
    setCerradoEnSesion(true)
  }, [slug])

  if (!abierto || !dato) return null
  // `slug` esta garantizado por `abierto`, pero el narrow se necesita para el link.
  const hrefPrivacidad = slug ? RUTAS.privacidad(slug) : null

  return (
    <PedirDatoSheet
      abierto
      dato={dato}
      nombreNegocio={nombreNegocio}
      guardando={guardando}
      error={error}
      hrefPrivacidad={hrefPrivacidad}
      onGuardar={(datos) => void guardar(datos)}
      onOmitir={omitir}
    />
  )
}
