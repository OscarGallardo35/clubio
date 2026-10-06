'use client'

import * as React from 'react'
import { useBranding } from '@/hooks/useBranding'
import { useSucursalActiva } from '@/hooks/useSucursalActiva'
import { useCliente } from '@/hooks/useCliente'
import { useVisitaQr } from '@/hooks/useVisitaQr'
import { useClienteStore } from '@/stores/clienteStore'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@repo/ui'
import { PasoRegistro } from './PasoRegistro'
import { PasoEspera } from './PasoEspera'
import { PasoConfirmado } from './PasoConfirmado'
import { PasoNoSumada } from './PasoNoSumada'
import { PasoError } from './PasoError'
import { RUTAS } from '@/lib/constants'

/**
 * Orquestador del flujo del club (QR #2).
 *
 * No resuelve el tenant ni hace fetch del negocio: los providers ya lo hicieron
 * (el layout lo trajo del servidor) y aca se lee del contexto. Lo unico que
 * consulta es la sesion del cliente y la visita.
 */
export function FlujoVisita() {

  const router = useRouter()
  const { negocio, configuracion, cargando: cargandoBranding } = useBranding()
  const { sucursal, slugParaApi } = useSucursalActiva()
  const { autenticado, cliente, resuelto } = useCliente()
  const tarjetas = useClienteStore((s) => s.tarjetas)
  const visita = useVisitaQr(slugParaApi)

  const meta = configuracion?.sellosParaPremio ?? 10
  const premioTexto = configuracion?.premioTexto ?? 'un premio'

  // Sellos que se muestran antes de sumar: la tarjeta de la sucursal activa.
  const deLaSucursal = sucursal ? tarjetas.find((t) => t.sucursalId === sucursal.id) : undefined
  const actuales = deLaSucursal?.sellosActuales ?? tarjetas[0]?.sellosActuales ?? 0

  // En la confirmacion manda el payload del WS (fuente de verdad).
  const actualesConfirmados = visita.flujo.sellos?.sellosActuales ?? actuales
  const premioConfirmado = visita.flujo.sellos?.premioDesbloqueado ?? false

  if (cargandoBranding && !negocio) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  const paso = visita.flujo.paso
  const comun = {
    nombreNegocio: negocio?.nombre ?? '',
    logoUrl: negocio?.logoUrl ?? null,
    colorPrimario: negocio?.colorPrimario || '#E63946',
    colorSecundario: negocio?.colorSecundario || '#F77F00',
    premioTexto,
    meta,
    actuales,
  }

  if (paso === 'inicio' || paso === 'registrando' || paso === 'solicitando') {
    return (
      <PasoRegistro
        {...comun}
        nombreCliente={cliente?.nombre ?? null}
        premioDesbloqueado={actuales >= meta}
        autenticado={autenticado}
        // Mientras no se sabe si hay sesion, el boton queda inhabilitado: con
        // eso no se le pide el nombre a alguien que ya es del club.
        cargando={visita.flujo.paso === 'solicitando' || (!resuelto && cargandoBranding)}
        onRegistrar={visita.registrar}
        onSumar={visita.solicitar}
      />
    )
  }

  if (paso === 'esperando' && visita.flujo.token) {
    return (
      <PasoEspera
        token={visita.flujo.token}
        expiraEn={visita.flujo.expiraEn}
        ws={visita.ws}
        numeroAtendiente={configuracion?.numeroAtendiente ?? negocio?.numeroAtendiente ?? null}
        mensajeWhatsApp={visita.mensajeWhatsApp ?? `Hola, quiero sumar mi visita en ${negocio?.nombre ?? 'el local'}`}
        onCancelar={visita.reiniciar}
      />
    )
  }

  if (paso === 'aprobada') {
    return (
      <PasoConfirmado
        {...comun}
        actuales={actualesConfirmados}
        premioDesbloqueado={premioConfirmado}
        nombreCliente={cliente?.nombre ?? null}
        mostrarResena={configuracion?.mostrarResenaPostVisita === true}
        placeId={negocio?.placeId ?? null}
        onVerTarjeta={() => router.push(RUTAS.tarjeta(negocio?.slug ?? ''))}
        onVolver={() => router.push(`/${negocio?.slug ?? ''}/menu`)}
      />
    )
  }

  if (paso === 'noSumada') {
    return (
      <PasoNoSumada
        motivo={visita.flujo.motivo}
        texto={visita.textoMotivo}
        onReintentar={visita.reintentar}
        onVerTarjeta={() => router.push(RUTAS.tarjeta(negocio?.slug ?? ''))}
        onVolverMenu={() => router.push(`/${negocio?.slug ?? ''}/menu`)}
      faltanHoras={visita.flujo.faltanHoras}
        />
    )
  }

  return (
    <PasoError
      mensaje={visita.flujo.mensaje}
      onReintentar={visita.reintentar}
      onVolverMenu={() => router.push(`/${negocio?.slug ?? ''}/menu`)}
    />
  )
}
