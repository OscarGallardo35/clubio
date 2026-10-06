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
import { pedidosApi } from '@/lib/api'
import { normalizarError, timeline } from '@/lib/checkout-maquina'
import type { EstadoPedido } from '@/lib/checkout-maquina'
import { crearSocketPedidos } from '@/lib/socket'
import { useClienteStore } from '@/stores/clienteStore'
import { useCarritoStore } from '@/stores/carritoStore'
import { useBranding } from '@/hooks/useBranding'
import type { PedidoPublico } from '@/types/api'

const INTERVALO_POLLING_MS = 5000
const ESPERA_WS_MS = 3000
const MAX_INTENTOS_WS = 3

type Fallo = 'no-encontrado' | 'vencido' | 'otro'

export interface SeguimientoProps {
  linkToken: string
  slugNegocio: string
}

/** El 410 aca es "link vencido", no "carta vencida". */
function clasificarFallo(status: number): Fallo {
  if (status === 404) return 'no-encontrado'
  if (status === 410) return 'vencido'
  return 'otro'
}

export function Seguimiento({ linkToken, slugNegocio }: SeguimientoProps) {
  const token = useClienteStore((s) => s.token)
  const pedidoGuardado = useCarritoStore((s) => s.pedido)
  const { negocio, resenasDisponibles } = useBranding()

  const [pedido, setPedido] = React.useState<PedidoPublico | null>(null)
  const [fallo, setFallo] = React.useState<Fallo | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [soloPolling, setSoloPolling] = React.useState(false)

  const pedidoRef = React.useRef<PedidoPublico | null>(null)
  pedidoRef.current = pedido

  const refetch = React.useCallback(async () => {
    try {
      const r = await pedidosApi.publico(linkToken)
      setPedido(r)
      setFallo(null)
    } catch (e) {
      const { status } = normalizarError(e)
      // Un error de red no borra lo que ya tenemos: se reintenta en el proximo tick.
      if (status !== 0) setFallo(clasificarFallo(status))
    } finally {
      setCargando(false)
    }
  }, [linkToken])

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

  if (cargando && !pedido) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Buscando tu pedido...</p>
  }

  if (fallo === 'no-encontrado') {
    return (
      <Aviso
        titulo="No encontramos tu pedido"
        detalle="Pedile al local que te reenvie el link."
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
  const whatsapp =
    pedidoGuardado && pedidoGuardado.linkToken === linkToken && pedidoGuardado.urlCorta && pedidoGuardado.mensajeWhatsApp
      ? { url: pedidoGuardado.urlCorta, mensaje: pedidoGuardado.mensajeWhatsApp }
      : undefined

  const pasos = timeline(pedido.estado as EstadoPedido)
  const cancelado = pedido.estado === 'CANCELADO' || pedido.estado === 'RECHAZADO'
  const entregado = pedido.estado === 'ENTREGADO'

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-4 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">
          {pedido.numeroAtendiente ? `Pedido ${pedido.numeroAtendiente}` : 'Tu pedido'}
        </h1>
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
              <span
                aria-hidden
                className={`size-3 shrink-0 rounded-full ${p.alcanzado ? 'bg-[var(--color-primary)]' : 'bg-muted'}`}
              />
              <span className={p.actual ? 'font-semibold' : p.alcanzado ? '' : 'text-muted-foreground'}>
                {p.etiqueta}
              </span>
            </li>
          ))}
        </ol>
      )}

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
          Pago: {pedido.modoPago.toLowerCase().replace('_', ' ')}
        </p>
      </section>

      {whatsapp ? (
        <a
          href={`${whatsapp.url}${whatsapp.url.includes('?') ? '&' : '?'}text=${encodeURIComponent(whatsapp.mensaje)}`}
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
