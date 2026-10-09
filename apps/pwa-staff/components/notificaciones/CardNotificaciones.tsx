'use client'

import * as React from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui'
import { usePushNotifications } from '@/hooks/usePushNotifications'

/**
 * Card "Activar notificaciones" de la PWA Staff (pantalla de perfil).
 *
 * No pide permiso sola: muestra la explicacion y el boton; el permiso lo dispara
 * el toque del usuario. En iPhone avisa que hace falta instalar la app.
 */
export function CardNotificaciones() {
  const { estado, activo, guardando, mensaje, activar } = usePushNotifications()

  if (estado === 'no-soportado' || estado === 'cargando') return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Notificaciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {activo ? (
          <p className="text-muted-foreground">
            Estan activadas: te avisamos cuando entre una visita o un pedido.
          </p>
        ) : estado === 'requiere-instalacion' ? (
          <p className="text-muted-foreground">
            En iPhone las notificaciones solo funcionan si agregas la app a la pantalla de inicio:
            toca <strong>Compartir</strong> y despues <strong>Añadir a inicio</strong>. Volve a
            entrar desde ese icono y activalas aca.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Activa las notificaciones para enterarte de las visitas pendientes y los pedidos
              nuevos aunque no tengas la app abierta.
            </p>
            {estado === 'denegado' ? (
              <p className="text-xs text-amber-600">
                Las bloqueaste antes. Habilitalas desde los ajustes del navegador para este sitio y
                volve a intentar.
              </p>
            ) : null}
            {mensaje ? <p className="text-xs text-amber-600">{mensaje}</p> : null}
            <Button className="min-h-12 w-full" onClick={() => void activar()} disabled={guardando}>
              {guardando ? 'Activando...' : 'Activar notificaciones'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
