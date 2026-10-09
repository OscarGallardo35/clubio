'use client'

import * as React from 'react'
import { usePushNotifications } from '@/hooks/usePushNotifications'

/**
 * Tarjeta "Activar notificaciones" de la PWA Cliente.
 *
 * Va al pie de Mi tarjeta (la tarjeta inmersiva), asi que se pinta como las otras
 * secciones sobre el degradado: fondo translucido + texto blanco.
 *
 * NO pide permiso sola: muestra la explicacion y el boton; el permiso lo dispara
 * el toque del usuario (ver usePushNotifications).
 */
export function CardNotificaciones() {
  const { estado, activo, guardando, mensaje, activar } = usePushNotifications()

  // Nada que ofrecer si el navegador no soporta push.
  if (estado === 'no-soportado' || estado === 'cargando') return null

  if (activo) {
    return (
      <section className="rounded-2xl bg-black/25 p-4 text-white ring-1 ring-white/20 backdrop-blur">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true">🔔</span> Notificaciones activadas
        </p>
        <p className="mt-1 text-xs text-white/80">
          Te avisamos cuando sumes sellos o tengas un premio para canjear.
        </p>
      </section>
    )
  }

  if (estado === 'requiere-instalacion') {
    return (
      <section className="rounded-2xl bg-black/25 p-4 text-white ring-1 ring-white/20 backdrop-blur">
        <p className="text-sm font-semibold">Instala la app primero</p>
        <p className="mt-1 text-xs text-white/80">
          En iPhone las notificaciones solo funcionan si agregas la app a la pantalla de inicio:
          toca <strong>Compartir</strong> y despues <strong>Añadir a inicio</strong>. Volve a entrar
          desde ese icono y activalas aca.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl bg-black/25 p-4 text-white ring-1 ring-white/20 backdrop-blur">
      <p className="text-sm font-semibold">Enterate de tus premios</p>
      <p className="mt-1 text-xs text-white/80">
        Activa las notificaciones para que te avisemos cuando sumes un sello o desbloquees un premio.
      </p>

      {estado === 'denegado' ? (
        <p className="mt-2 text-xs text-amber-200">
          Las bloqueaste antes. Habilitalas desde los ajustes del navegador para este sitio y volve a
          intentar.
        </p>
      ) : null}
      {mensaje ? <p className="mt-2 text-xs text-amber-200">{mensaje}</p> : null}

      <button
        type="button"
        onClick={() => void activar()}
        disabled={guardando}
        className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-white/95 px-4 text-sm font-semibold text-pink-900 shadow disabled:opacity-60"
      >
        {guardando ? 'Activando…' : 'Activar notificaciones'}
      </button>
    </section>
  )
}
