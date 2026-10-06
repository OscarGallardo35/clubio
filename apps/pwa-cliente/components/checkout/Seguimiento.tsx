'use client'

/**
 * Seguimiento del pedido por linkToken.
 *
 * Fuente de verdad: el POLLING cada 5 s a GET /api/pedidos/publico/:linkToken. El WS es solo un
 * adelanto del refresco cuando el cliente esta logueado.
 *
 * Por que el polling no es un "respaldo": el gateway de /pedidos exige token en el handshake y
 * corta el socket si no hay identidad, asi que el que escanea el QR sin cuenta NO tiene WS. Para
 * ese caso (que es el flujo del QR #1) el polling es el unico mecanismo.
 *
 * El payload del WS viene incompleto a proposito (`{ pedidoId, estado, actualizadoEn, motivoRechazo }`),
 * asi que no se usa para reemplazar el estado: dispara un refetch y el GET manda.
 *
 * Los errores NO usan `clasificarError`: ese clasificador es del checkout, donde el 410 significa
 * "la carta cambio". Aca el 410 es "el link del pedido vencio". Mismo status, otro contexto.
 */
import * as React from 'react'
import Link from 'next/link'
import type { Socket } from 'socket.io-client'
import { buttonVariants } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'
import { api, pedidosApi } from '@/lib/api'
import { ETIQUETAS_MODO_PAGO, clasificarFalloPedido, normalizarError, timeline, urlWhatsAppStaff } from '@/lib/checkout-maquina'
import type { EstadoPedido } from '@/lib/checkout-maquina'
import type { FalloSeguimiento } from '@/lib/checkout-maquina'
import { crearSocketPedidos } from '@/lib/socket'
import { useClienteStore } from '@/stores/clienteStore'
import { useCarritoStore } from '@/stores/carritoStore'
import { useBranding } from '@/hooks/useBranding'
import type { PedidoPublico } from '@/types/api'

const INTERVALO_POLLING_MS = 5000
const ESPERA_WS_MS = 3000
const MAX_INTENTOS_WS = 3

export interface SeguimientoProps {
  linkToken: string
  slugNegocio: string
}

export function Seguimiento({ linkToken, slugNegocio }: SeguimientoProps) {
  const token = useClienteStore((s) => s.token)
  const pedidoGuardado = useCarritoStore((s) => s.pedido)
  const despachar = useCarritoStore((s) => s.despachar)
  const { negocio, resenasDisponibles } = useBranding()

  const [pedido, setPedido] = React.useState<PedidoPublico | null>(null)
  const [fallo, setFallo] = React.useState<FalloSeguimiento | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [soloPolling, setSoloPolling] = React.useState(false)

  const pedidoRef = React.useRef<PedidoPublico | null>(null)
  pedidoRef.current = pedido

  const refetch = React.useCallback(async () => {
    try {
      // El tenant se fija ACA, con el slug que ya viene en la URL, y no se espera al
      // `api.setTenant` del BrandingProvider: los efectos corren de hijo a padre, asi que en una
      // carga en frio esta request sale ANTES y el backend contesta 404 "falta el tenant". Es
      // idempotente (setTenant solo guarda el slug en el cliente).
      api.setTenant(slugNegocio)
      const r = await pedidosApi.publico(linkToken)
      setPedido(r)
      setFallo(null)
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      // Un error de red no borra lo que ya tenemos: se reintenta en el proximo tick.
      if (status !== 0) {
        const f = clasificarFalloPedido(status, mensaje)
        setFallo(f)
        // Solo el 404 REAL (pedido no encontrado) suelta el pedido. El de "falta el tenant" es
        // transitorio: el link existe, el header llego tarde.
        if (f === 'no-encontrado' && pedidoGuardado?.linkToken === linkToken) {
          despachar({ tipo: 'OLVIDAR_PEDIDO' })
        }
      }
    } finally {
      setCargando(false)
    }
  }, [linkToken, slugNegocio, pedidoGuardado?.linkToken, despachar])

  // 1) Polling. Se corta cuando el pedido llego a un estado final (no cambia mas).
  React.useEffect(() => {
    void refetch()
  }, [refetch])

  React.useEffect(() => {
    const final = pedido?.estado === 'ENTREGADO' || pedido?.estado === 'CANCELADO' || pedido?.estado === 'RECHAZADO'
    if (final || fallo === 'no-encontrado' || fallo === 'vencido') return undefined
    const t = setInterval(() => void refetch(), INTERVALO_POLLING_MS)
    return () => clearInterval(t)
  }, [refetch, pedido?.estado, fallo])

  // 2) WS como adelanto, solo si hay sesion de cliente.
  React.useEffect(() => {
    if (!token) {
      setSoloPolling(true)
      return undefined
    }
    let socket: Socket | null = null
    let intentos = 0
    let vivo = true
    let timeout: ReturnType<typeof setTimeout> | undefined

    const conectar = () => {
      if (!vivo) return
      socket = crearSocketPedidos(token, pedidoRef.current?.id ?? null)
      timeout = setTimeout(() => {
        // No conecto en 3 s: seguimos con polling y se avisa en el footer.
        if (!socket?.connected) setSoloPolling(true)
      }, ESPERA_WS_MS)
      socket.on('pedido:estado-actualizado', () => void refetch())
      socket.on('disconnect', () => {
        if (!vivo) return
        intentos += 1
        if (intentos >= MAX_INTENTOS_WS) {
          setSoloPolling(true)
          return
        }
        // Backoff exponencial: 1s, 2s, 4s...
        setTimeout(conectar, 1000 * 2 ** (intentos - 1))
      })
    }
    conectar()

    return () => {
      vivo = false
      if (timeout) clearTimeout(timeout)
      socket?.disconnect()
    }
  }, [token, refetch])

  // 'tenant' es transitorio: se sigue mostrando el mismo cartel de espera y el polling NO se corta
  // (el efecto de polling solo frena con 'no-encontrado'/'vencido'/estado final).
  if ((cargando || fallo === 'tenant') && !pedido) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Buscando tu pedido...</p>
  }

  if (fallo === 'no-encontrado') {
    return (
      <Aviso
        titulo="Este pedido ya no esta disponible"
        detalle="Es posible que ya se haya completado o que el link haya sido eliminado."
        slugNegocio={slugNegocio}
      />
    )
  }
  if (fallo === 'vencido') {
    return (
      <Aviso
        titulo="Este link ya vencio"
        detalle="Pedile al local que te lo reenvie para ver el estado."
        slugNegocio={slugNegocio}
      />
    )
  }
  if (fallo === 'otro' || !pedido) {
    return <Aviso titulo="No pudimos mostrar tu pedido" detalle="Proba de nuevo en un rato." slugNegocio={slugNegocio} />
  }

  // El WhatsApp sale del store, y SOLO si el pedido guardado es el de este linkToken (si no,
  // abrir otro link mostraria el mensaje de un pedido ajeno). Un pedido viejo no lo tiene: ahi no
  // se muestra el boton.
  // El boton abre WhatsApp con el numero del atendiente (el que resuelve el backend al crear el
  // pedido). Antes la base era `urlCorta`, que es la pagina del pedido: el boton abria la app del
  // staff en vez de WhatsApp. El mensaje ya incluye el link del staff adentro.
  const mensajeWhatsApp =
    pedidoGuardado && pedidoGuardado.linkToken === linkToken ? pedidoGuardado.mensajeWhatsApp : undefined
  // El numero sale del pedido (lo resuelve el backend al crearlo) y, si esa sucursal no tenia
  // atendiente configurado, del default del negocio.
  const numeroAtendiente = pedido.numeroAtendiente ?? negocio?.numeroAtendiente ?? null
  const whatsapp = mensajeWhatsApp ? urlWhatsAppStaff(numeroAtendiente, mensajeWhatsApp) : null

  const pasos = timeline(pedido.estado as EstadoPedido)
  const cancelado = pedido.estado === 'CANCELADO' || pedido.estado === 'RECHAZADO'
  const entregado = pedido.estado === 'ENTREGADO'

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-4 pb-24">
      <header className="flex flex-col gap-1">
        {/*
          El titulo NO usa `numeroAtendiente`: ese campo no es un numero de pedido, es el numero del
          "atendiente" (config del negocio, por sucursal) y en la practica trae un telefono. Tampoco
          el nombre ni el telefono del cliente: esos van en la seccion Cliente.
        */}
        <h1 className="text-lg font-semibold">Tu pedido</h1>
        <p className="text-sm text-muted-foreground">
          {negocio?.nombre ?? pedido.sucursal.nombre} · {pedido.tipo === 'MESA' ? `Mesa ${pedido.mesa ?? '-'}` : pedido.tipo === 'DELIVERY' ? 'Envio' : 'Para llevar'}
        </p>
      </header>

      {cancelado ? (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">
            {pedido.estado === 'RECHAZADO' ? 'El local rechazo el pedido' : 'El pedido fue cancelado'}
          </p>
          {pedido.motivoRechazo ? <p className="mt-1">{pedido.motivoRechazo}</p> : null}
        </div>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Estado del pedido">
          {pasos.map((p) => (
            <li key={p.estado} className="flex items-center gap-3 text-sm">
              {/* Tres estados visuales distintos: completado (lleno), actual (lleno + anillo) y
                  pendiente (hueco). Con dos estados, un pedido PENDIENTE se veia igual que uno
                  entregado. */}
              <span
                aria-hidden
                className={
                  p.actual
                    ? 'size-4 shrink-0 rounded-full bg-primary ring-2 ring-primary/30'
                    : p.alcanzado
                      ? 'size-4 shrink-0 rounded-full bg-primary'
                      : 'size-4 shrink-0 rounded-full border-2 border-border'
                }
              />
              <span
                className={
                  p.actual ? 'font-semibold' : p.alcanzado ? '' : 'text-muted-foreground'
                }
              >
                {p.etiqueta}
              </span>
            </li>
          ))}
        </ol>
      )}

      <section aria-label="Cliente" className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{pedido.nombreCliente}</span>
        <span className="text-muted-foreground">{pedido.telefono}</span>
      </section>

      {pedido.tipo === 'DELIVERY' && pedido.direccion ? (
        <p className="text-sm text-muted-foreground">Envio a {pedido.direccion}</p>
      ) : null}

      <section aria-label="Detalle del pedido" className="flex flex-col gap-2 rounded-xl border p-3">
        <ul className="flex flex-col gap-2">
          {pedido.items.map((i, idx) => (
            <li key={`${i.itemId}-${idx}`} className="flex items-start justify-between gap-3 text-sm">
              <span>
                {i.cantidad}x {i.nombre}
                {i.modificadores.length > 0 ? (
                  <span className="block text-muted-foreground">
                    con {i.modificadores.map((m) => m.opcionNombre).join(', ')}
                  </span>
                ) : null}
                {i.notas ? <span className="block text-muted-foreground">"{i.notas}"</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatearPrecio(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatearPrecio(pedido.subtotal)}</span>
        </div>
        {pedido.costoEnvio ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Envio</span>
            <span className="tabular-nums">{formatearPrecio(pedido.costoEnvio)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-base font-semibold">{formatearPrecio(pedido.total)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Pago: {ETIQUETAS_MODO_PAGO[pedido.modoPago] ?? pedido.modoPago}
        </p>
      </section>

      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ className: 'min-h-12' })}
        >
          Abrir WhatsApp
        </a>
      ) : null}

      {entregado || cancelado ? (
        <div className="flex flex-col gap-2">
          {entregado && resenasDisponibles ? (
            <Link href={`/${slugNegocio}/club`} className={buttonVariants({ variant: 'outline', className: 'min-h-12' })}>
              Dejar resena
            </Link>
          ) : null}
          <Link href={`/${slugNegocio}/menu`} className={buttonVariants({ variant: entregado ? 'outline' : 'default', className: 'min-h-12' })}>
            Volver al menu
          </Link>
        </div>
      ) : null}

        <p className="text-center text-xs text-muted-foreground">
          {soloPolling ? 'Actualizando cada 5 s' : 'Actualizacion en vivo'}
        </p>
      </div>
    )
  }

function Aviso({ titulo, detalle, slugNegocio }: { titulo: string; detalle: string; slugNegocio: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
      <p className="font-medium">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalle}</p>
      <Link href={`/${slugNegocio}/menu`} className={buttonVariants({ className: 'min-h-12' })}>
        Volver al menu
      </Link>
    </div>
  )
}
