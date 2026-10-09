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
import { Button, BottomSheet, buttonVariants } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'
import { api, pedidosApi } from '@/lib/api'
import { ETIQUETAS, ETIQUETAS_MODO_PAGO, clasificarFalloPedido, debeOlvidarPedido, normalizarError, timeline, urlWhatsAppStaff } from '@/lib/checkout-maquina'
import type { EstadoPedido } from '@/lib/checkout-maquina'
import type { FalloSeguimiento } from '@/lib/checkout-maquina'
import { crearSocketPedidos } from '@/lib/socket'
import { useCliente } from '@/hooks/useCliente'
import { useClienteStore } from '@/stores/clienteStore'
import { useCarritoStore } from '@/stores/carritoStore'
import { useBranding } from '@/hooks/useBranding'
import type { PedidoPublico } from '@/types/api'

const INTERVALO_POLLING_MS = 5000
const ESPERA_WS_MS = 3000
const MAX_INTENTOS_WS = 3

/** Los 8 estados validos (unica fuente: las etiquetas del checkout). */
const ESTADOS_VALIDOS = new Set<string>(Object.keys(ETIQUETAS))

/** Guard del payload del WS: solo se acepta un estado que exista. */
function esEstadoPedido(valor: unknown): valor is EstadoPedido {
  return typeof valor === 'string' && ESTADOS_VALIDOS.has(valor)
}

/**
 * El payload del WS trae el `pedidoId`. La sala `cliente:{id}` recibe los eventos de TODOS los
 * pedidos del cliente, asi que un evento de otro pedido no puede tocar el de esta pantalla: solo
 * se aplica si el id coincide con el pedido que se esta siguiendo.
 */
function esDeEstePedido(pedidoId: unknown, actual: PedidoPublico | null): boolean {
  return !!actual && typeof pedidoId === 'string' && pedidoId === actual.id
}

export interface SeguimientoProps {
  linkToken: string
  slugNegocio: string
}

export function Seguimiento({ linkToken, slugNegocio }: SeguimientoProps) {
  const token = useClienteStore((s) => s.token)
  // La sesion del cliente puede ser SOLO una cookie HttpOnly (JS no la lee) y el
  // token en memoria queda null. `useCliente` resuelve si hay sesion real via
  // GET /auth/cliente/me: es la senal que necesita el efecto del WS.
  const { autenticado: sesionAutenticada, resuelto: sesionResuelta } = useCliente()
  const pedidoGuardado = useCarritoStore((s) => s.pedido)
  const despachar = useCarritoStore((s) => s.despachar)
  const activar = useCarritoStore((s) => s.activar)
  const { negocio, resenasDisponibles } = useBranding()

  // El store del carrito usa `skipHydration`: NADIE lo hidrata solo. Hasta ahora `activar` lo
  // llamaban el checkout y la carta, asi que abrir el link del pedido en una pestana nueva
  // (o recargar) dejaba `pedido` en null y el boton de WhatsApp NO aparecia — aunque el
  // mensaje estuviera guardado. Sin esto, el boton solo existia si venias navegando desde el
  // checkout, con el store ya en memoria.
  // Sucursal en null a proposito: `rehidratar` conserva la sucursal guardada y no dispara el
  // vaciado por cambio de sucursal.
  React.useEffect(() => {
    void activar(slugNegocio, null, null)
  }, [activar, slugNegocio])

  const [pedido, setPedido] = React.useState<PedidoPublico | null>(null)
  const [fallo, setFallo] = React.useState<FalloSeguimiento | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [soloPolling, setSoloPolling] = React.useState(false)
  // Cancelacion del cliente: la puerta del linkToken (el mismo que autentica el seguimiento).
  const [confirmandoCancelacion, setConfirmandoCancelacion] = React.useState(false)
  const [cancelando, setCancelando] = React.useState(false)
  const [errorCancelacion, setErrorCancelacion] = React.useState<string | null>(null)

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
      // El store guarda el pedido EN CURSO. Si el link que estamos siguiendo ES ese pedido, se
      // sincroniza su estado: es lo que hace que un CANCELADO deje de contar como activo (y que el
      // checkout suelte el 409 "pedido activo"). El GET es la fuente de verdad, asi que esto cubre
      // tambien al guest del QR (que no tiene WebSocket y solo tiene este polling).
      if (pedidoGuardado?.linkToken === linkToken) {
        despachar({ tipo: 'PEDIDO_ESTADO', estado: r.estado })
      }
    } catch (e) {
      const { status, mensaje } = normalizarError(e)
      // Un error de red no borra lo que ya tenemos: se reintenta en el proximo tick.
      if (status !== 0) {
        const f = clasificarFalloPedido(status, mensaje)
        setFallo(f)
        // DOS fallos son terminales, no uno: el 404 real (el link no existe) y el 410 (el link
        // vencio). Los dos sueltan el pedido guardado, si no el banner del menu queda en loop.
        // El de "falta el tenant" es transitorio: el link existe, el header llego tarde.
        if (debeOlvidarPedido(f, linkToken, pedidoGuardado?.linkToken)) {
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
  //
  // OJO: la sesion puede ser SOLO una cookie HttpOnly (JS no la lee), asi que
  // `token` es null en una carga en frio o tras un F5. Antes el efecto cortaba
  // con `if (!token)`, y eso dejaba al cliente SIEMPRE en polling: el socket
  // nunca se abria y el cancel en vivo no llegaba. Se dispara si hay token en
  // memoria O si `useCliente` confirmo sesion (la cookie autentica el handshake).
  React.useEffect(() => {
    if (!token && !sesionAutenticada) {
      // Sin token el veredicto todavia no llego: no se marca soloPolling hasta
      // que /me resuelva, para no quedarse sin socket por un falso negativo.
      if (sesionResuelta) setSoloPolling(true)
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
      socket.on('pedido:estado-actualizado', (p: { pedidoId?: unknown; estado?: unknown }) => {
        // El payload del WS SI trae el estado (a diferencia del resto de los campos): si es de este
        // pedido, se refleja en el store al instante. El refetch de abajo sincroniza igual.
        if (esDeEstePedido(p?.pedidoId, pedidoRef.current) && esEstadoPedido(p.estado)) {
          despachar({ tipo: 'PEDIDO_ESTADO', estado: p.estado })
        }
        void refetch()
      })
      // El cancelado del staff (o del cron) tiene su propio evento. Mismo guard de identidad: la
      // sala del cliente recibe los eventos de todos sus pedidos.
      socket.on('pedido:cancelado', (p: { pedidoId?: unknown }) => {
        if (esDeEstePedido(p?.pedidoId, pedidoRef.current)) {
          despachar({ tipo: 'PEDIDO_ESTADO', estado: 'CANCELADO' })
        }
        void refetch()
      })
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
  }, [token, sesionAutenticada, sesionResuelta, refetch, despachar])

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

  const pasos = timeline(pedido.estado as EstadoPedido)
  const cancelado = pedido.estado === 'CANCELADO' || pedido.estado === 'RECHAZADO'
  const entregado = pedido.estado === 'ENTREGADO'

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
  // Un pedido cancelado o rechazado NO ofrece "Abrir WhatsApp": no hay nada que coordinar con el
  // local. El resto de la vista final (badge rojo, motivoRechazo y "Volver al menu") sale mas abajo.
  const whatsapp = !cancelado && mensajeWhatsApp ? urlWhatsAppStaff(numeroAtendiente, mensajeWhatsApp) : null

  // Misma regla que el backend: solo PENDIENTE o CONFIRMADO. No se ofrece un boton que ya se
  // sabe que va a terminar en 400.
  const puedeCancelar = pedido.estado === 'PENDIENTE' || pedido.estado === 'CONFIRMADO'

  // OJO: NO puede ser un hook (`useCallback`): este componente tiene early returns arriba
  // (`cargando`, `fallo`), asi que un hook aca adentro se ejecuta en unas ramas y en otras no
  // y React explota con "#310: rendered more hooks than during the previous render".
  const cancelar = async () => {
    setCancelando(true)
    setErrorCancelacion(null)
    try {
      await pedidosApi.cancelarPorLink(linkToken)
      setConfirmandoCancelacion(false)
      await refetch()
    } catch (e) {
      const { mensaje } = normalizarError(e)
      setErrorCancelacion(mensaje || 'No pudimos cancelar el pedido. Proba de nuevo.')
    } finally {
      setCancelando(false)
    }
  }

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
                {i.notas ? <span className="block text-muted-foreground">&quot;{i.notas}&quot;</span> : null}
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

      {puedeCancelar ? (
        <Button
          variant="outline"
          className="min-h-12"
          onClick={() => {
            setErrorCancelacion(null)
            setConfirmandoCancelacion(true)
          }}
        >
          Cancelar pedido
        </Button>
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

      {/* Confirmacion: cancelar no se deshace, asi que no se dispara con un solo toque.
          Se usa BottomSheet (el Dialog de @repo/ui sigue siendo un stub). */}
      <BottomSheet
        abierto={confirmandoCancelacion}
        onCerrar={() => { if (!cancelando) setConfirmandoCancelacion(false) }}
        titulo="Cancelar el pedido?"
        altura="auto"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            El local va a ver el pedido como cancelado. No se puede deshacer.
          </p>
          {errorCancelacion ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errorCancelacion}
            </p>
          ) : null}
          <Button variant="default" className="min-h-12" disabled={cancelando} onClick={() => void cancelar()}>
            {cancelando ? 'Cancelando...' : 'Si, cancelar el pedido'}
          </Button>
          <Button
            variant="outline"
            className="min-h-12"
            disabled={cancelando}
            onClick={() => setConfirmandoCancelacion(false)}
          >
            Volver
          </Button>
        </div>
      </BottomSheet>
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
