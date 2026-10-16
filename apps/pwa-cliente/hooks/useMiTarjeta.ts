'use client'

/**
 * Trae la tarjeta del cliente (GET /visitas/mi-tarjeta).
 *
 * `habilitado` lo decide el que llama: sin sesion NO se pega (el backend contestaria 401 y ese 401
 * no es un error, es "no logueado").
 *
 * Se refresca solo cuando el saldo del cliente cambia: los WS `saldo:cambiado` (el evento UNICO
 * del backend) y `visita:aprobada` (el historico) disparan el MISMO refetch.
 * El WS necesita el token EN MEMORIA (la cookie es HttpOnly y el handshake no la lee desde JS).
 *
 * Y si el WS NO esta vivo (pantalla en segundo plano, celular dormido, reconexiones agotadas),
 * revalida por su cuenta cada `RESPALDO_TARJETA_MS` MIENTRAS la pestana este visible. Antes de
 * eso, sin socket la tarjeta quedaba con datos viejos INDEFINIDAMENTE.
 */
import * as React from 'react'
import { visitasApi } from '@/lib/api'
import { normalizarError } from '@/lib/checkout-maquina'
import { esTenantMismatch } from '@/lib/tenant'
import { crearSocketVisitas } from '@/lib/socket'
import { TICK_RESPALDO_TARJETA_MS, debeRefrescarRespaldo } from '@/lib/sondeo'
import { useClienteStore } from '@/stores/clienteStore'
import type { MiTarjetaRespuesta } from '@/types/api'

export interface UsoMiTarjeta {
  tarjeta: MiTarjetaRespuesta | null
  cargando: boolean
  error: string | null
  /** true si el 403 fue por sesion de OTRO negocio (ver `esTenantMismatch`). */
  tenantMismatch: boolean
  refetch: () => Promise<void>
}

export function useMiTarjeta(sucursalSlug: string | null, habilitado: boolean): UsoMiTarjeta {
  const token = useClienteStore((s) => s.token)
  const [tarjeta, setTarjeta] = React.useState<MiTarjetaRespuesta | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tenantMismatch, setTenantMismatch] = React.useState(false)

  const refetch = React.useCallback(async () => {
    if (!habilitado) {
      setCargando(false)
      return
    }
    setCargando(true)
    try {
      const r = await visitasApi.miTarjeta(sucursalSlug)
      setTarjeta(r)
      setError(null)
      setTenantMismatch(false)
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      // 401 = sin sesion (no es un error: el estado "no logueado" tiene su propia pantalla).
      // 403 por tenant: tampoco es un fallo de la app, es una sesion de otro local.
      if (esTenantMismatch(status, mensaje)) setTenantMismatch(true)
      if (status !== 401 && !esTenantMismatch(status, mensaje)) setError(mensaje || 'No pudimos cargar tu tarjeta')
    } finally {
      setCargando(false)
    }
  }, [habilitado, sucursalSlug])

  /**
   * Ultima vez que se DISPARO un refetch (por WS, al volver a la app o por el respaldo).
   *
   * Es la marca que usa el sondeo de respaldo para NO duplicar trabajo: si el WS acaba de
   * traer el cambio, el proximo GET del respaldo espera un intervalo entero.
   */
  const ultimoRefresco = React.useRef(Date.now())
  const refrescar = React.useCallback(() => {
    ultimoRefresco.current = Date.now()
    void refetch()
  }, [refetch])

  React.useEffect(() => {
    refrescar()
  }, [refrescar])

  React.useEffect(() => {
    if (!habilitado) return undefined
    const socket = crearSocketVisitas(token)
    /**
     * UN solo handler para las dos senales de "tu saldo cambio":
     *
     *  - `saldo:cambiado` es el evento UNICO del backend: lo emiten los TRES lugares que mueven el
     *    saldo (visita/pedido acreditado, regalo de un disparo/campaña, y la correccion del monto
     *    de una visita, que era el hueco historico: la tarjeta abierta no se refrescaba).
     *  - `visita:aprobada` se sigue escuchando porque el backend lo emite igual, el flujo de la
     *    visita lo usa para la confirmacion, y hay PWAs cacheadas que solo conocen ese evento.
     *
     * Los dos disparan el MISMO refetch. Se descarta el segundo si llega pegado al primero: una
     * visita aprobada emite los DOS eventos, y no tiene sentido pegarle dos veces al backend
     * (mismo criterio que el `visibilitychange` de abajo).
     */
    const ultimo = { t: 0 }
    const alCambiarElSaldo = () => {
      const ahora = Date.now()
      if (ahora - ultimo.t < 1200) return
      ultimo.t = ahora
      refrescar()
    }
    socket.on('saldo:cambiado', alCambiarElSaldo)
    socket.on('visita:aprobada', alCambiarElSaldo)
    return () => {
      socket.disconnect()
    }
  }, [habilitado, token, refrescar])

  /**
   * Al VOLVER a la app, re-consultar la tarjeta.
   *
   * El WS del saldo solo empuja mientras la app esta en primer plano: si el cliente la
   * manda al fondo (o el telefono se duerme) y despues abre la notificacion, el service worker
   * solo ENFOCA la ventana que ya estaba en `/tarjeta` (no la navega ni la recarga), asi que la
   * tarjeta seguia mostrando el saldo viejo — sin premio y sin el boton de canje. Re-consultar al
   * hacerse visible cierra ese hueco. No hay parpadeo: `cargando && !tarjeta` es el unico caso
   * que dibuja el esqueleto.
   */
  React.useEffect(() => {
    if (!habilitado) return undefined
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [habilitado, refrescar])

  /**
   * Respaldo: revalidar la tarjeta aunque el WebSocket este DORMIDO.
   *
   * El hueco que cierra: el WS solo empuja mientras hay socket vivo. Si la PWA quedo en
   * segundo plano, el celular durmio o se agotaron los intentos de reconexion (`reconnectionAttempts:
   * 5`), los eventos `saldo:cambiado` / `visita:aprobada` no llegan y la tarjeta se quedaba con
   * datos VIEJOS indefinidamente: el cliente veia su saldo sin actualizar hasta mandar la app al
   * fondo y volver (que es lo que disparaba el `visibilitychange` de arriba). Eso se siente roto,
   * no lento.
   *
   * Como: se DESPIERTA cada `TICK_RESPALDO_TARJETA_MS` (5 s, sin red) y consulta solo si pasaron
   * `RESPALDO_TARJETA_MS` (10 s) desde el ULTIMO refresco (sea del WS o del propio respaldo) y la
   * pestana esta visible. Las tres condiciones importan:
   *  - visible: el cliente no esta mirando y el navegador throttlea los timers igual;
   *  - el intervalo desde el ultimo refresco: un evento del WS no se duplica con un GET;
   *  - el timer (y no un `setInterval` de 10 s con fetch adentro): mantiene la cadencia pegada al
   *    ultimo refresco real en vez de acumular desfasaje.
   * El `clearInterval` del cleanup lo cancela al desmontar.
   */
  React.useEffect(() => {
    if (!habilitado) return undefined
    const tick = setInterval(() => {
      const visible = document.visibilityState === 'visible'
      if (!debeRefrescarRespaldo(Date.now(), ultimoRefresco.current, visible)) return
      refrescar()
    }, TICK_RESPALDO_TARJETA_MS)
    return () => clearInterval(tick)
  }, [habilitado, refrescar])

  return { tarjeta, cargando, error, tenantMismatch, refetch }
}
