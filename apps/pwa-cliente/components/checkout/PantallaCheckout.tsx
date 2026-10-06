'use client'

/**
 * Pantalla de checkout: formulario + resumen del carrito.
 *
 * El componente NO manda el pedido: valida, arma el body con `armarBody` y se lo pasa a
 * `onEnviar` (el hook hace la llamada y maneja los errores del backend). Asi la pantalla queda
 * testeable y el hook es el unico lugar donde se pega al backend.
 *
 * OJO con el SSR (punto 7 del plan): el carrito vive en localStorage (zustand con `persist`), asi
 * que el HTML del servidor NO puede traer los items reales. Lo que se renderiza en el servidor es
 * el shell y el estado "cargando"; los items aparecen en el primer render del cliente. Cualquier
 * verificacion SSR que busque los items va a fallar por diseño, no por bug.
 */
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@repo/ui'
import { formatearPrecio } from '@repo/utils'
import { seleccionarTotal, useCarritoStore } from '@/stores/carritoStore'
import { useBranding } from '@/hooks/useBranding'
import { armarBody, textoEntregado } from '@/lib/checkout-maquina'
import { precioUnitario, validarCheckout } from '@/lib/carrito-maquina'
import type { DatosCliente, ModoPago, TipoPedido } from '@/lib/carrito-maquina'
import type { CrearPedidoBody } from '@/types/api'

export interface PantallaCheckoutProps {
  /** El hook lo inyecta. Si no viene, la pantalla solo valida (util para /dev). */
  onEnviar?: ((body: CrearPedidoBody) => void) | undefined
  /** Para el redirect cuando el carrito esta vacio. */
  slugNegocio: string
  /**
   * Solo para CARTA_VENCIDA (410): refetchea la carta, limpia el carrito y vuelve al menu. Vive en
   * la pagina porque necesita el cache de la carta, que esta en useCarta.
   */
  onRecargarCarta?: (() => void) | undefined
  enviando?: boolean | undefined
  /**
   * Sucursal viva (la del provider). El redirect por carrito vacio espera a tenerla: entre que el
   * store hidrata y que la sucursal se resuelve hay una ventana donde hasHydrated ya es true e
   * items.length es 0, y evaluar ahi mandaba al menu con el carrito lleno.
   */
  sucursalId?: string | null | undefined
}

const TIPOS: { valor: TipoPedido; etiqueta: string }[] = [
  { valor: 'MESA', etiqueta: 'En la mesa' },
  { valor: 'TAKEAWAY', etiqueta: 'Para llevar' },
  { valor: 'DELIVERY', etiqueta: 'Delivery' },
]

const PAGOS: { valor: ModoPago; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  { valor: 'MERCADO_PAGO', etiqueta: 'Mercado Pago' },
]

/** Error de un campo, o undefined. */
type Fallas = ReturnType<typeof validarCheckout>

export function PantallaCheckout({ onEnviar, slugNegocio, enviando = false, onRecargarCarta, sucursalId }: PantallaCheckoutProps) {
  const router = useRouter()
  const { negocio } = useBranding()
  const carrito = useCarritoStore()
  const total = useCarritoStore(seleccionarTotal)
  const despachar = carrito.despachar

  // Los errores NO se muestran hasta el primer intento (refinamiento 1).
  const [intentoEnviar, setIntentoEnviar] = React.useState(false)
  /** true cuando zustand termino de leer localStorage (no es "estoy en el cliente"). */
  const [locale, setLocale] = React.useState(false)

  const refs = React.useRef<Record<string, HTMLElement | null>>({})
  const registrar = (campo: string) => (el: HTMLElement | null) => {
    refs.current[campo] = el
  }

  // Guard de hidratacion REAL. Antes habia un `useState(false)` que se ponia en true en el primer
  // effect del cliente: eso solo dice "estoy en el navegador", NO que zustand haya terminado de
  // leer localStorage. Como el store usa `skipHydration`, entre el primer render y la hidratacion
  // el carrito se ve vacio, y el redirect se disparaba antes de tiempo.
  React.useEffect(() => {
    if (useCarritoStore.persist.hasHydrated()) setLocale(true)
    return useCarritoStore.persist.onFinishHydration(() => setLocale(true))
  }, [])

  // LOG TEMPORAL - sacar despues del diagnostico
  console.log('[checkout] render con sucursalId:', sucursalId, '| items:', carrito.items.length, '| locale:', locale)

  /**
   * "Asentado" = paso un instante desde que se hidrato. Es una RED DE SEGURIDAD: la guarda por
   * sucursal sola puede quedarse esperando para siempre (si `activa` no resuelve, la pagina no
   * decide nunca y queda en "Cargando..."). Con el plazo, la decision se toma igual: el carrito ya
   * tuvo tiempo de hidratar, asi que si esta vacio es porque esta vacio de verdad.
   */
  const [asentado, setAsentado] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setAsentado(true), 1500)
    return () => clearTimeout(t)
  }, [])

  const puedeDecidir = locale && asentado

  React.useEffect(() => {
    // LOG TEMPORAL - sacar despues del diagnostico
    console.log('[checkout] eval:', {
      locale,
      asentado,
      sucursalId,
      itemsLength: carrito.items.length,
      puedeDecidir,
    })
    if (!puedeDecidir) return
    if (carrito.items.length === 0) {
      // LOG TEMPORAL - sacar despues del diagnostico
      console.log('[checkout] REDIRECT: carrito vacio despues de hidratar y esperar')
      toast('Tu carrito esta vacio')
      router.replace(`/${slugNegocio}/menu`)
    }
  }, [puedeDecidir, locale, asentado, sucursalId, carrito.items.length, router, slugNegocio])

  const fallas: Fallas = validarCheckout(carrito)
  const mostrar = (campo: keyof Fallas) => (intentoEnviar ? fallas[campo] : undefined)

  const enviar = () => {
    setIntentoEnviar(true)
    const errores = validarCheckout(carrito)
    // Focus al primer campo invalido, en el orden visual del formulario.
    const orden: (keyof Fallas)[] = ['items', 'tipo', 'mesa', 'direccion', 'modoPago', 'nombre', 'telefono']
    const primero = orden.find((c) => errores[c])
    if (primero) {
      refs.current[primero]?.focus()
      return
    }
    despachar({ tipo: 'ENVIAR' })
    onEnviar?.(armarBody(carrito))
  }

  const setCliente = (campo: keyof DatosCliente, valor: string) =>
    despachar({ tipo: 'SET_CLIENTE', campo, valor })

  const err = (campo: keyof Fallas) => {
    const msj = mostrar(campo)
    return {
      'aria-invalid': msj ? true : undefined,
      'aria-describedby': msj ? `err-${campo}` : undefined,
      msj,
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-4 pb-24">
      <header className="flex items-center gap-3">
        {negocio?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={negocio.logoUrl} alt="" className="size-10 rounded-full object-cover" />
        ) : null}
        <div>
          <h1 className="text-lg font-semibold">Tu pedido</h1>
          {negocio?.nombre ? <p className="text-sm text-muted-foreground">{negocio.nombre}</p> : null}
        </div>
      </header>

      {/* Resumen: es lo que el cliente revisa antes de mandar. */}
      <section aria-label="Resumen del carrito" className="flex flex-col gap-2 rounded-xl border p-3">
        {!puedeDecidir ? (
          <p className="text-sm text-muted-foreground">Cargando tu pedido...</p>
        ) : carrito.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay items en el carrito.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {carrito.items.map((i) => (
                <li key={i.clave} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    {i.cantidad}x {i.nombre}
                    {i.modificadores.length > 0 ? (
                      <span className="block text-muted-foreground">
                        con {i.modificadores.flatMap((m) => m.opciones.map((o) => o.nombre)).join(', ')}
                      </span>
                    ) : null}
                    {i.notas ? <span className="block text-muted-foreground">"{i.notas}"</span> : null}
                  </span>
                  {/* El subtotal incluye los modificadores: sumando las lineas tiene que dar el total. */}
                  <span className="shrink-0 tabular-nums">{formatearPrecio(precioUnitario(i) * i.cantidad)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-base font-semibold">{formatearPrecio(total)}</span>
            </div>
          </>
        )}
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Como lo querés?</legend>
        {TIPOS.map((tp) => (
          <label key={tp.valor} className="flex min-h-12 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="tipo"
              value={tp.valor}
              checked={carrito.tipo === tp.valor}
              disabled={enviando}
              onChange={() => despachar({ tipo: 'SET_TIPO', nuevoTipo: tp.valor })}
              ref={tp.valor === 'MESA' ? (registrar('tipo') as never) : undefined}
              className="size-5 accent-[var(--color-primary)]"
            />
            <span className="text-sm">{tp.etiqueta}</span>
          </label>
        ))}
        {err('tipo').msj ? (
          <p id="err-tipo" className="text-sm text-destructive">{err('tipo').msj}</p>
        ) : null}
      </fieldset>

      {carrito.tipo === 'MESA' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="mesa" className="font-medium">Numero de mesa</label>
          <input
            id="mesa"
            ref={registrar('mesa') as never}
            value={carrito.cliente.mesa ?? ''}
            disabled={enviando}
            onChange={(e) => setCliente('mesa', e.target.value)}
            inputMode="numeric"
            aria-invalid={err('mesa')['aria-invalid']}
            aria-describedby={err('mesa')['aria-describedby']}
            className={`min-h-12 rounded-lg border bg-background px-3 ${err('mesa').msj ? 'border-destructive' : ''}`}
          />
          {err('mesa').msj ? <p id="err-mesa" className="text-sm text-destructive">{err('mesa').msj}</p> : null}
        </div>
      ) : null}

      {carrito.tipo === 'DELIVERY' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="direccion" className="font-medium">Direccion de entrega</label>
          <input
            id="direccion"
            ref={registrar('direccion') as never}
            value={carrito.cliente.direccion ?? ''}
            disabled={enviando}
            onChange={(e) => setCliente('direccion', e.target.value)}
            aria-invalid={err('direccion')['aria-invalid']}
            aria-describedby={err('direccion')['aria-describedby']}
            className={`min-h-12 rounded-lg border bg-background px-3 ${err('direccion').msj ? 'border-destructive' : ''}`}
          />
          {err('direccion').msj ? <p id="err-direccion" className="text-sm text-destructive">{err('direccion').msj}</p> : null}
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Como vas a pagar?</legend>
        {PAGOS.map((p) => (
          <label key={p.valor} className="flex min-h-12 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="modoPago"
              value={p.valor}
              checked={carrito.modoPago === p.valor}
              disabled={enviando}
              onChange={() => despachar({ tipo: 'SET_MODO_PAGO', modoPago: p.valor })}
              className="size-5 accent-[var(--color-primary)]"
            />
            <span className="text-sm">{p.etiqueta}</span>
          </label>
        ))}
        {err('modoPago').msj ? (
          <p id="err-modoPago" className="text-sm text-destructive">{err('modoPago').msj}</p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="nombre" className="font-medium">Tu nombre</label>
        <input
          id="nombre"
          ref={registrar('nombre') as never}
          value={carrito.cliente.nombre}
          disabled={enviando}
          onChange={(e) => setCliente('nombre', e.target.value)}
          aria-invalid={err('nombre')['aria-invalid']}
          aria-describedby={err('nombre')['aria-describedby']}
          className={`min-h-12 rounded-lg border bg-background px-3 ${err('nombre').msj ? 'border-destructive' : ''}`}
        />
        {err('nombre').msj ? <p id="err-nombre" className="text-sm text-destructive">{err('nombre').msj}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="telefono" className="font-medium">Telefono</label>
        <input
          id="telefono"
          ref={registrar('telefono') as never}
          value={carrito.cliente.telefono}
          disabled={enviando}
          onChange={(e) => setCliente('telefono', e.target.value)}
          inputMode="tel"
          aria-invalid={err('telefono')['aria-invalid']}
          aria-describedby={err('telefono')['aria-describedby']}
          className={`min-h-12 rounded-lg border bg-background px-3 ${err('telefono').msj ? 'border-destructive' : ''}`}
        />
        {err('telefono').msj ? <p id="err-telefono" className="text-sm text-destructive">{err('telefono').msj}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="notasPedido" className="font-medium">
          Notas <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id="notasPedido"
          value={carrito.notasPedido ?? ''}
          disabled={enviando}
          maxLength={500}
          rows={2}
          onChange={(e) => despachar({ tipo: 'SET_NOTAS_PEDIDO', notas: e.target.value })}
          className="w-full resize-none rounded-lg border bg-background p-3 text-sm"
        />
        <span className="self-end text-xs text-muted-foreground">
          {(carrito.notasPedido ?? '').length} / 500
        </span>
      </div>

      {carrito.error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <p>{carrito.error.mensaje}</p>
          {carrito.error.codigo === 'CARTA_VENCIDA' ? (
            // El 410 no se arregla reintentando: la carta cambio y hay que traer la nueva.
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-destructive/40 text-destructive"
              onClick={() => onRecargarCarta?.()}
              disabled={!onRecargarCarta}
            >
              Recargar carta
            </Button>
          ) : (
            /* REINTENTAR solo limpia el error: sirve cuando la causa fue transitoria (red). */
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-destructive/40 text-destructive"
              onClick={() => despachar({ tipo: 'REINTENTAR' })}
            >
              Reintentar
            </Button>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* Habilitado a proposito: si estuviera disabled hasta validar, el primer toque nunca
            ocurriria y el usuario no veria NUNCA los errores (refinamiento 1). */}
        <Button type="button" onClick={enviar} disabled={enviando} className="min-h-12 w-full">
          {enviando ? 'Enviando...' : `Enviar pedido (${formatearPrecio(total)})`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={enviando}
          onClick={() => {
            despachar({ tipo: 'CERRAR_CHECKOUT' })
            router.push(`/${slugNegocio}/menu`)
          }}
          className="w-full text-muted-foreground"
        >
          Volver al menu
        </Button>
      </div>

      {carrito.tipo ? (
        <p className="text-center text-xs text-muted-foreground">{textoEntregado(carrito.tipo)}</p>
      ) : null}
    </div>
  )
}
