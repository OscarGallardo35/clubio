'use client'

/**
 * Mi tarjeta (QR #1): la tarjeta de sellos real del cliente + el banner de premio.
 *
 * Fuente de datos: GET /api/visitas/mi-tarjeta (una sola llamada). El branding (nombre, logo,
 * colores, modo de fidelizacion) sale de useBranding, que ya lo resolvio el layout del tenant.
 *
 * Regla que se respeta aca: un 401 NO es un error. Si no hay sesion se muestra el estado
 * "todavia no tenes tarjeta" con el CTA al club, no un cartel de fallo.
 */
import * as React from 'react'
import Link from 'next/link'
import { Progress, Skeleton, TarjetaSellos, buttonVariants } from '@repo/ui'
import { useBranding } from '@/hooks/useBranding'
import { useCliente } from '@/hooks/useCliente'
import { useMiTarjeta } from '@/hooks/useMiTarjeta'
import { useSucursalActiva } from '@/hooks/useSucursalActiva'
import { COLOR_PRIMARIO_DEFECTO, COLOR_SECUNDARIO_DEFECTO, RUTAS } from '@/lib/constants'
import { vistaDeTarjeta } from '@/lib/tarjeta'

export function PantallaTarjeta({ slugNegocio }: { slugNegocio: string }) {
  const { negocio, configuracion, cargando: cargandoBranding } = useBranding()
  const { slugParaApi } = useSucursalActiva()
  // Auto-login: pega a /auth/cliente/me con la cookie. `resuelto` dice si ya se sabe si hay sesion.
  const { autenticado, resuelto } = useCliente()
  const { tarjeta, cargando, error, refetch } = useMiTarjeta(slugParaApi, resuelto && autenticado)

  const colorPrimario = negocio?.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const colorSecundario = negocio?.colorSecundario || COLOR_SECUNDARIO_DEFECTO

  if ((!resuelto || cargandoBranding) && !negocio) return <Cargando />
  if (resuelto && !autenticado) return <SinSesion slugNegocio={slugNegocio} />
  if (error) return <Fallo mensaje={error} onReintentar={() => void refetch()} />
  if (cargando && !tarjeta) return <Cargando />
  if (!tarjeta) return <SinSesion slugNegocio={slugNegocio} />

  const v = vistaDeTarjeta(tarjeta, configuracion?.modoFidelizacion)

  // Con HIBRIDO el cliente puede tener los DOS premios: se listan los que esten desbloqueados.
  const premiosDesbloqueados = [
    v.mostrarSellos && v.sellos.premioDesbloqueado ? v.sellos.premioTexto : null,
    v.mostrarPuntos && v.puntos.premioDesbloqueado ? v.puntos.premioTexto : null,
  ].filter((x): x is string => Boolean(x))

  const faltanteTexto = v.mostrarSellos
    ? v.sellos.faltantes === 1
      ? 'Te falta 1 sello para tu premio'
      : `Te faltan ${v.sellos.faltantes} sellos para tu premio`
    : v.puntos.faltantes === 1
      ? 'Te falta 1 punto para tu premio'
      : `Te faltan ${v.puntos.faltantes} puntos para tu premio`

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6">
      <TarjetaSellos
        nombreCliente={v.nombreCliente}
        nombreNegocio={negocio?.nombre ?? ''}
        logoUrl={negocio?.logoUrl ?? undefined}
        tipo={v.tipo === 'HIBRIDO' ? 'VISITAS' : v.tipo}
        actuales={v.actuales}
        meta={v.meta}
        premioTexto={v.premioTexto}
        colorPrimario={colorPrimario}
        colorSecundario={colorSecundario}
        tamaño="full"
        // 'glass' es la variante pensada para fondos con color: /tarjeta es una ruta inmersiva.
        variante="glass"
        mostrarUltimaVisita
        {...(v.ultimaVisita ? { ultimaVisita: v.ultimaVisita } : {})}
      />

      {/* Con HIBRIDO, la segunda barra: los sellos tienen su grilla en la tarjeta de arriba, los
          puntos van aca. Se dibuja en la pantalla y no dentro de <TarjetaSellos /> porque ese
          componente es COMPARTIDO (@repo/ui) y solo sabe de sellos. */}
      {v.mostrarPuntos ? (
        <section className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/20 backdrop-blur">
          {v.mostrarSellos ? (
            <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-white/70">
              Sellos {v.sellos.actuales}/{v.sellos.meta} · Puntos {v.puntos.actuales}/{v.puntos.meta}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2 text-sm text-white">
            <span className="font-medium">Puntos</span>
            <span className="tabular-nums text-white/85">
              {v.puntos.actuales}/{v.puntos.meta}
            </span>
          </div>
          <Progress
            value={v.puntos.porcentaje}
            className="mt-2 h-2 bg-white/20"
            indicatorClassName="bg-amber-400"
          />
          <p className="mt-2 text-center text-xs text-white/85">
            {v.puntos.premioDesbloqueado
              ? `Ya podes canjear ${v.puntos.premioTexto}`
              : `Te faltan ${v.puntos.faltantes} puntos para ${v.puntos.premioTexto}`}
          </p>
        </section>
      ) : null}

      {premiosDesbloqueados.length > 0 ? (
        <section
          role="status"
          className="rounded-2xl bg-emerald-500/20 p-4 text-center ring-1 ring-emerald-400/50"
        >
          <p className="text-lg font-bold text-white drop-shadow">
            {premiosDesbloqueados.length > 1 ? 'Tenes dos premios' : 'Tenes un premio'}
          </p>
          {premiosDesbloqueados.map((premio) => (
            <p key={premio} className="text-sm font-medium text-white/90">
              {premio}
            </p>
          ))}
          {/* No hay canje en la app: el canje es presencial y lo valida el staff. Un boton que no
              hace nada seria peor que esta instruccion. */}
          <p className="mt-2 text-xs text-white/80">Mostrala en el local para canjearlo.</p>
        </section>
      ) : (
        <p className="text-center text-sm text-white/80">{faltanteTexto}</p>
      )}

      {v.sucursalNombre ? (
        <p className="text-center text-xs text-white/70">Tarjeta de {v.sucursalNombre}</p>
      ) : null}
    </div>
  )
}

function Cargando() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

function SinSesion({ slugNegocio }: { slugNegocio: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-white drop-shadow">Todavía no tenés tarjeta</p>
      <p className="text-sm text-white/85">
        Escaneá el QR en el local para sumar tu primera visita.
      </p>
      <Link
        href={RUTAS.club(slugNegocio)}
        className={buttonVariants({ className: 'min-h-12' })}
      >
        Ir al club
      </Link>
    </div>
  )
}

function Fallo({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-white drop-shadow">No pudimos mostrar tu tarjeta</p>
      <p className="text-sm text-white/85">{mensaje}</p>
      <button type="button" onClick={onReintentar} className={buttonVariants({ className: 'min-h-12' })}>
        Reintentar
      </button>
    </div>
  )
}
