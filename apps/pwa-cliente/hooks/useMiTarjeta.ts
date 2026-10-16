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
import { RESPALDO_TARJETA_MS, debeRefrescarRespaldo, esperaHastaElRespaldo } from '@/lib/sondeo'
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
   * Es la marca que usa el respaldo para NO duplicar trabajo: si el WS acaba de traer el cambio,
   * el proximo GET del respaldo espera un intervalo entero desde ESE refresco.
   */
  const ultimoRefresco = React.useRef(Date.now())
  /** Re-agenda el respaldo. Lo asigna el efecto de abajo; `refrescar` lo usa para reprogramar. */
  const reprogramarRespaldo = React.useRef<() => void>(() => {})
  const refrescar = React.useCallback(() => {
    ultimoRefresco.current = Date.now()
    reprogramarRespaldo.current()
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
   * El hueco que cierra: el WS solo empuja mientras hay socket vivo. Si la PWA quedo en segundo
   * plano, el celular durmio o se agotaron los intentos de reconexion (`reconnectionAttempts: 5`),
   * los eventos `saldo:cambiado` / `visita:aprobada` no llegan y la tarjeta se quedaba con datos
   * VIEJOS indefinidamente: el cliente veia su saldo sin actualizar hasta mandar la app al fondo y
   * volver (que es lo que disparaba el `visibilitychange` de arriba). Eso se siente roto, no lento.
   *
   * Como: UN timer que se reprograma a `RESPALDO_TARJETA_MS` desde el ULTIMO refresco — el del WS
   * incluido, porque `refrescar` tambien reprograma. Al tocar el timer:
   *  - pestana VISIBLE y paso el intervalo → refetch (y el refetch reprograma);
   *  - pestana OCULTA → no se consulta nada, solo se vuelve a agendar (el navegador throttlea los
   *    timers de fondo igual);
   *  - un refresco del WS cayo recien → se agenda lo que FALTA del intervalo, no un intervalo
   *    entero (si no, ese cambio empujaria el respaldo al doble: el bug de la cadencia 10/15 s).
   *
   * Por que un timer y no un `setInterval` de 5 s con guarda: con `intervalo/2` de tick y una
   * guarda de `>= intervalo`, cualquier deriva de milisegundos decide entre consultar y saltar, y
   * la cadencia real oscilaba entre 10 s y 15 s. Un timer re-programado da 10 s clavados.
   * El cleanup lo cancela al desmontar (y suelta la reprogramacion).
   */
  React.useEffect(() => {
    if (!habilitado) return undefined
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const programar = (espera = RESPALDO_TARJETA_MS) => {
      if (!vivo) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(alTocar, espera)
    }

    function alTocar() {
      if (!vivo) return
      const ahora = Date.now()
      const visible = document.visibilityState === 'visible'
      if (debeRefrescarRespaldo(ahora, ultimoRefresco.current, visible)) {
        // `refrescar` reprograma el proximo respaldo a un intervalo completo.
        refrescar()
        return
      }
      // Oculta: se reintenta en un intervalo (sin red). Visible pero con un refresco del WS recien
      // llegado: se espera solo lo que falta.
      programar(visible ? esperaHastaElRespaldo(ahora, ultimoRefresco.current) : RESPALDO_TARJETA_MS)
    }

    reprogramarRespaldo.current = programar
    programar()

    return () => {
      vivo = false
      reprogramarRespaldo.current = () => {}
      if (timer) clearTimeout(timer)
    }
  }, [habilitado, refrescar])

  return { tarjeta, cargando, error, tenantMismatch, refetch }
}
