'use client'

/**
 * "Tus premios ganados": la lista de premios que el cliente YA gano (un `PremioOtorgado` de un
 * disparo o una campana), con la accion que corresponde a cada estado.
 *
 * POR QUE EXISTE (el caso grave): el mecanismo de canje (link del staff + WhatsApp) vivia SOLO
 * dentro de la modal de aceptar. Si el cliente la cerraba —o descartaba el push— un premio
 * ACEPTADO quedaba IRRECUPERABLE; en un premio LIBRE eso es perder el premio entero, porque no
 * mueve saldo y su unico valor es canjearlo en el local. Aca el link se puede volver a mostrar
 * siempre: viene en `premios[].verificacion` de `GET /visitas/mi-tarjeta`.
 *
 * NO CONFUNDIR con el premio del CLUB (por llegar a la meta de sellos/puntos): ese lo dibuja
 * `PantallaTarjeta` con el titulo "Tu premio del club". Este bloque es lo GANADO.
 *
 * Lista vertical (no carrusel): soporta varios premios a la vez, uno por tarjeta. En 375px todo
 * usa `min-w-0` + `break-words` (este proyecto ya tuvo bugs de desborde horizontal).
 */
import * as React from 'react'
import { premiosApi } from '@/lib/api'
import type { PremioGanado } from '@/types/api'

export function MisPremios({
  premios,
  total,
  onRefrescar,
}: {
  premios: PremioGanado[]
  /** Total real de premios (el array viene capado por el backend). */
  total?: number | undefined
  /** Refresca la tarjeta (mismo `refetch` de `useMiTarjeta`): reusa `saldo:cambiado`/visibility. */
  onRefrescar: () => void | Promise<void>
}) {
  const [aceptando, setAceptando] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const aceptar = async (token: string) => {
    if (aceptando) return
    setAceptando(token)
    setError(null)
    try {
      const res = await premiosApi.aceptar(token)
      // `ok:false` = el premio ya no se podia aceptar (vencido). Igual se refresca: el listado lo
      // va a mostrar como VENCIDO y el mensaje explica por que.
      if (!res.ok) setError('Ese premio ya no se puede aceptar.')
      await onRefrescar()
    } catch {
      setError('No pudimos aceptar el premio. Probá de nuevo en unos segundos.')
    } finally {
      setAceptando(null)
    }
  }

  if (premios.length === 0) return null

  const ocultos = Math.max(0, (total ?? premios.length) - premios.length)

  return (
    <section aria-labelledby="mis-premios-titulo" className="flex min-w-0 flex-col gap-3">
      <h2
        id="mis-premios-titulo"
        className="text-center text-xs font-semibold uppercase tracking-[0.15em] text-white/75 drop-shadow"
      >
        Tus premios ganados
      </h2>

      {error ? (
        <p role="alert" className="text-center text-xs font-medium text-amber-100 drop-shadow">
          {error}
        </p>
      ) : null}

      {premios.map((premio) => (
        <TarjetaPremio
          key={premio.token}
          premio={premio}
          aceptando={aceptando === premio.token}
          onAceptar={() => void aceptar(premio.token)}
        />
      ))}

      {ocultos > 0 ? (
        <p className="text-center text-[11px] text-white/60">
          {ocultos === 1 ? 'Y 1 premio más en tu historial' : `Y ${ocultos} premios más en tu historial`}
        </p>
      ) : null}
    </section>
  )
}

function TarjetaPremio({
  premio,
  aceptando,
  onAceptar,
}: {
  premio: PremioGanado
  aceptando: boolean
  onAceptar: () => void
}) {
  const ver = premio.verificacion
  const origen = premio.campanaNombre
    ? `Campaña: ${premio.campanaNombre}`
    : premio.disparoNombre
      ? `De: ${premio.disparoNombre}`
      : null

  /** Historial: peso visual bajo, sin accion. */
  if (premio.estado === 'CANJEADO') {
    const fecha = fechaLegible(premio.canjeadoEn)
    return (
      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-black/20 px-3 py-2 ring-1 ring-white/10">
        <span aria-hidden className="text-xs text-emerald-300">
          ✓
        </span>
        <p className="min-w-0 break-words text-xs text-white/75">
          <span className="font-medium">{premio.texto}</span>
          {fecha ? ` · Canjeado el ${fecha}` : ' · Canjeado'}
        </p>
      </div>
    )
  }

  /** Vencido: se avisa, no se ofrece nada. Mismo peso bajo que el historial. */
  if (premio.estado === 'VENCIDO') {
    return (
      <div className="rounded-xl bg-black/15 px-3 py-2 ring-1 ring-white/10">
        <p className="min-w-0 break-words text-xs text-white/55">
          <span className="font-medium">{premio.texto}</span>
          {premio.expiraLegible ? ` · Venció el ${premio.expiraLegible}` : ' · Venció'}
        </p>
      </div>
    )
  }

  const aceptado = premio.estado === 'ACEPTADO'

  return (
    <div
      className={`flex min-w-0 flex-col rounded-2xl p-4 ring-1 backdrop-blur ${
        aceptado ? 'bg-emerald-500/20 ring-emerald-400/50' : 'bg-black/25 ring-white/20'
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
        {aceptado ? 'Listo para canjear' : 'Pendiente de aceptar'}
      </p>
      <p className="mt-0.5 min-w-0 break-words text-base font-bold text-white drop-shadow">
        {premio.texto}
      </p>
      <p className="mt-0.5 min-w-0 break-words text-xs text-white/85">{etiquetaTipo(premio)}</p>
      {origen ? <p className="mt-0.5 min-w-0 break-words text-[11px] text-white/60">{origen}</p> : null}
      {premio.expiraLegible ? (
        <p className="mt-1 text-[11px] text-white/70">Válido hasta el {premio.expiraLegible}</p>
      ) : null}

      {aceptado ? (
        // EL CASO GRAVE, ARREGLADO: el link del staff vuelve a estar disponible aca aunque el
        // cliente haya cerrado la modal. Es el MISMO mecanismo (url del servidor + WhatsApp al
        // numero de atencion del local), recuperado del listado.
        <>
          <p className="mt-2 text-[11px] text-white/75">
            Mostralo en el local para canjearlo: el local verifica el premio y lo marca como canjeado.
          </p>
          {ver?.url ? (
            <a
              href={ver.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-white/95 px-4 text-center text-sm font-semibold text-emerald-900 shadow"
            >
              Mostrar en el local
            </a>
          ) : (
            <p className="mt-3 text-[11px] text-white/70">
              No pudimos cargar el código de canje. Actualizá la pantalla para volver a verlo.
            </p>
          )}
          {ver?.whatsapp ? (
            <a
              href={ver.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-black/30 px-4 text-center text-sm font-semibold text-white ring-1 ring-white/25"
            >
              Avisar al local por WhatsApp
            </a>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          disabled={aceptando}
          onClick={onAceptar}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 shadow disabled:opacity-50"
        >
          {aceptando ? 'Aceptando…' : 'Aceptar'}
        </button>
      )}
    </div>
  )
}

/**
 * Texto del TIPO del premio. En un PENDIENTE no se puede afirmar que ya acredito (depende del modo
 * del club: un premio de SELLOS en un club SOLO_PUNTOS no suma sellos), asi que ahi se dice "para tu
 * tarjeta"; en ACEPTADO/CANJEADO si acredito.
 */
function etiquetaTipo(premio: PremioGanado): string {
  if (premio.tipo === 'LIBRE') {
    return premio.estado === 'PENDIENTE'
      ? 'Premio del local: se canjea al aceptarlo'
      : 'Premio del local: se canjea en el mostrador'
  }
  const unidad =
    premio.tipo === 'SELLOS'
      ? premio.cantidad === 1
        ? 'sello'
        : 'sellos'
      : premio.cantidad === 1
        ? 'punto'
        : 'puntos'
  return premio.estado === 'PENDIENTE'
    ? `${premio.cantidad} ${unidad} para tu tarjeta`
    : `${premio.cantidad} ${unidad} acreditados`
}

/**
 * Fecha corta en hora de Argentina. `timeZone` EXPLICITO: la pantalla se renderiza tambien en el
 * servidor y sin fijarlo el HTML del server y el del cliente podrian diferir (hydration mismatch).
 */
function fechaLegible(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Argentina/Buenos_Aires',
    })
  } catch {
    return iso.slice(0, 10)
  }
}
