'use client'

/**
 * Mi tarjeta (QR #1): la tarjeta de sellos real del cliente + el banner de premio.
 *
 * Fuente de datos: GET /api/visitas/mi-tarjeta (una sola llamada). El branding (nombre, logo,
 * colores, modo de fidelizacion, theme) sale de useBranding, que ya lo resolvio el layout del tenant.
 *
 * Regla que se respeta aca: un 401 NO es un error. Si no hay sesion se muestra el estado
 * "todavia no tenes tarjeta" con el CTA al club, no un cartel de fallo.
 *
 * THEME: si el negocio tiene `theme` (ver @repo/types getTheme), la tarjeta se dibuja con el
 * diseno personalizado; si no, cae al diseno historico. El bloque de puntos se oculta cuando
 * el theme lo pide (`mostrarPuntos: false`).
 */
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getTheme } from '@repo/types'
import { Progress, Skeleton, TarjetaSellos, buttonVariants } from '@repo/ui'
import { useBranding } from '@/hooks/useBranding'
import { useCliente } from '@/hooks/useCliente'
import { useMiTarjeta } from '@/hooks/useMiTarjeta'
import { useSucursalActiva } from '@/hooks/useSucursalActiva'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { CardNotificaciones } from '@/components/notificaciones/CardNotificaciones'
import { COLOR_PRIMARIO_DEFECTO, COLOR_SECUNDARIO_DEFECTO, RUTAS } from '@/lib/constants'
import { vistaDeTarjeta } from '@/lib/tarjeta'

/**
 * El boton demo "+1 sello" se ve siempre en desarrollo y en prod solo con
 * NEXT_PUBLIC_DEMO_TARJETA=true (variable de BUILD: Next la inyecta en el bundle).
 */
const DEMO_HABILITADO =
  process.env.NEXT_PUBLIC_DEMO_TARJETA === 'true' || process.env.NODE_ENV !== 'production'

export function PantallaTarjeta({ slugNegocio }: { slugNegocio: string }) {
  const { negocio, configuracion, cargando: cargandoBranding, tieneFeature } = useBranding()
  const { slugParaApi } = useSucursalActiva()
  // Auto-login: pega a /auth/cliente/me con la cookie. `resuelto` dice si ya se sabe si hay sesion.
  const { autenticado, resuelto, sesionDeOtroLocal, logout } = useCliente()
  const { tarjeta, cargando, error, refetch, tenantMismatch } = useMiTarjeta(slugParaApi, resuelto && autenticado)
  const reducedMotion = useReducedMotion()
  // +1 sello (demo): suma EN MEMORIA para mostrar la animacion en vivo. NUNCA escribe en la DB.
  const [sellosDemo, setSellosDemo] = React.useState(0)

  const theme = getTheme(negocio)
  const colorPrimario = negocio?.colorPrimario || COLOR_PRIMARIO_DEFECTO
  const colorSecundario = negocio?.colorSecundario || COLOR_SECUNDARIO_DEFECTO

  if ((!resuelto || cargandoBranding) && !negocio) return <Cargando />
  // La sesion guardada es de OTRO local: no es un fallo de la app ni un 401. Se ofrece cambiar de
  // cuenta (la cookie es HttpOnly: la baja el logout del backend, no el navegador).
  if (sesionDeOtroLocal || tenantMismatch) {
    return <CambiarDeCuenta slugNegocio={slugNegocio} onSalir={logout} />
  }
  if (resuelto && !autenticado) return <SinSesion slugNegocio={slugNegocio} />
  if (error) return <Fallo mensaje={error} onReintentar={() => void refetch()} />
  if (cargando && !tarjeta) return <Cargando />
  if (!tarjeta) return <SinSesion slugNegocio={slugNegocio} />

  const v = vistaDeTarjeta(tarjeta, configuracion?.modoFidelizacion)
  // El demo suma sobre el contador principal (sellos); se corta en la meta.
  const actualesConDemo = Math.min(v.actuales + sellosDemo, v.meta)
  const demoAlTope = actualesConDemo >= v.meta
  // El premio por SELLOS tambien cuenta si la DEMO llego a la meta. Sin esto la tarjeta se ve
  // completa (8/8 con su celebracion) pero el boton de WhatsApp de canje nunca aparece, porque
  // `sellosDemo` vive solo en memoria y el server sigue contando los sellos reales.
  const premioSellosDesbloqueado =
    v.sellos.premioDesbloqueado || (DEMO_HABILITADO && sellosDemo > 0 && v.meta > 0 && demoAlTope)
  // Con theme.mostrarPuntos === false, el bloque de puntos se oculta.
  const mostrarPuntos = v.mostrarPuntos && (theme ? theme.mostrarPuntos !== false : true)

  // Con HIBRIDO el cliente puede tener los DOS premios: se listan los que esten desbloqueados.
  const premiosDesbloqueados = [
    v.mostrarSellos && premioSellosDesbloqueado ? v.sellos.premioTexto : null,
    v.mostrarPuntos && v.puntos.premioDesbloqueado ? v.puntos.premioTexto : null,
  ].filter((x): x is string => Boolean(x))

  const faltanteTexto = v.mostrarSellos
    ? v.sellos.faltantes === 1
      ? 'Te falta 1 sello para tu premio'
      : `Te faltan ${v.sellos.faltantes} sellos para tu premio`
    : v.puntos.faltantes === 1
      ? 'Te falta 1 punto para tu premio'
      : `Te faltan ${v.puntos.faltantes} puntos para tu premio`

  /**
   * CTA de canje: con la tarjeta completa el cliente necesita UNA accion siguiente; el mensaje solo
   * no alcanza. El canje sigue siendo PRESENCIAL (lo valida el staff), asi que el boton solo abre el
   * chat con el local.
   *
   * Condiciones: premio desbloqueado y numero de atencion configurado (config del club -> negocio,
   * el mismo que usa PasoEspera). NO depende del theme: se ve tambien en los locales SIN theme
   * (bar-la-esquina). Si no hay numero, no hay boton. Cuando el cliente ya canjeo (los sellos se
   * restan y el premio deja de estar desbloqueado) el boton desaparece solo.
   *
   * El mensaje incluye el LINK PUBLICO de verificacion (`/<slug>/verificar/<token>`) para que el
   * local confirme en el momento que los sellos/premio son reales, sin login.
   */
  const numeroAtendiente = configuracion?.numeroAtendiente ?? negocio?.numeroAtendiente ?? null
  // La URL la arma el SERVIDOR (`urlVerificacion` en GET /visitas/mi-tarjeta) con PUBLIC_APP_URL.
  // NO reconstruirla con `window.location.origin`: si el cliente esta en el subdominio del tenant
  // (`que-lomitos.clubio.lat`) el link saldria con el slug dos veces y la pagina publica de
  // verificacion devuelve "este enlace no es valido".
  const urlVerificacion = tarjeta.urlVerificacion ?? null
  const waCanje =
    premiosDesbloqueados.length > 0 && numeroAtendiente
      ? `https://wa.me/${numeroAtendiente.replace(/\D/g, '')}?text=${encodeURIComponent(
          `Hola, soy ${v.nombreCliente}. Completé mi tarjeta en ${negocio?.nombre ?? 'el local'} y quiero canjear ${premiosDesbloqueados[0]}.` +
            (urlVerificacion ? ` Verificalo acá: ${urlVerificacion}` : ''),
        )}`
      : null

  return (
    // Con theme, la tarjeta es mas ancha (hasta 400px): en mobile el `px-4` la dejaba en
    // 343px, asi que se baja a `px-2` (en 375 da ~359px, entra con margen). La pantalla
    // historica (sin theme) mantiene `px-4` y su ancho intacto.
    <div className={`mx-auto flex w-full max-w-md flex-col gap-5 py-6 ${theme ? 'px-2' : 'px-4'}`}>
      <TarjetaSellos
        nombreCliente={v.nombreCliente}
        nombreNegocio={negocio?.nombre ?? ''}
        logoUrl={negocio?.logoUrl ?? undefined}
        tipo={v.tipo === 'HIBRIDO' ? 'VISITAS' : v.tipo}
        actuales={actualesConDemo}
        meta={v.meta}
        premioTexto={v.premioTexto}
        colorPrimario={colorPrimario}
        colorSecundario={colorSecundario}
        tamaño="full"
        // 'glass' es la variante pensada para fondos con color: /tarjeta es una ruta inmersiva.
        variante="glass"
        mostrarUltimaVisita
        reducedMotion={reducedMotion}
        theme={theme}
        // Icono de esquina (solo rama con theme): se deriva del slug. Prefiere
        // el slug del branding resuelto; cae al de la URL si todavia no cargo.
        slugTenant={negocio?.slug ?? slugNegocio}
        {...(v.ultimaVisita ? { ultimaVisita: v.ultimaVisita } : {})}
      />

      {DEMO_HABILITADO ? (
        <div className="flex items-center justify-center gap-3" data-slot="demo-tarjeta">
          <button
            type="button"
            disabled={demoAlTope}
            onClick={() => setSellosDemo((n) => n + 1)}
            className={buttonVariants({
              variant: 'secondary',
              className: 'min-h-11 disabled:opacity-40',
            })}
          >
            +1 sello (demo)
          </button>
          {sellosDemo > 0 ? (
            <button
              type="button"
              onClick={() => setSellosDemo(0)}
              className="text-xs font-medium text-white/80 underline"
            >
              Reiniciar demo
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Con HIBRIDO, la segunda barra: los sellos tienen su grilla en la tarjeta de arriba, los
          puntos van aca. Se dibuja en la pantalla y no dentro de <TarjetaSellos /> porque ese
          componente es COMPARTIDO (@repo/ui) y solo sabe de sellos. */}
      {mostrarPuntos ? (
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
          {waCanje ? (
            <a
              href={waCanje}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-white/95 px-4 text-sm font-semibold text-emerald-900 shadow"
            >
              Avisarle al local por WhatsApp
            </a>
          ) : null}
        </section>
      ) : theme ? null : (
        // Con theme, la tarjeta YA dice el progreso en su mensaje unico: repetirlo aca era la
        // contradiccion del reporte (la tarjeta mostraba 8/8 y esta linea, con el dato real, 5).
        // Sin theme se mantiene tal cual.
        <p className="text-center text-sm text-white/80">{faltanteTexto}</p>
      )}

      {v.sucursalNombre ? (
        <p className="text-center text-xs text-white/70">Tarjeta de {v.sucursalNombre}</p>
      ) : null}

      {/* Solo si el plan del local incluye push (si no, el backend responde 403 al suscribir). */}
      {tieneFeature('push') ? <CardNotificaciones /> : null}
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

/**
 * La sesion guardada pertenece a OTRO local: el backend contesta 403 "no coincide con la solicitud".
 *
 * No se muestra el error crudo (es una situacion esperable: el cliente entro a otro club desde el
 * mismo telefono) ni se lo deja en un callejon: se le ofrece salir y entrar con la cuenta de ESTE
 * local. Ojo: la cookie es HttpOnly, asi que no se puede borrar desde el navegador; el boton pasa
 * por el logout del backend y recien despues navega al club.
 */
function CambiarDeCuenta({
  slugNegocio,
  onSalir,
}: {
  slugNegocio: string
  onSalir: () => Promise<void>
}) {
  const router = useRouter()
  const [saliendo, setSaliendo] = React.useState(false)

  async function cambiar() {
    setSaliendo(true)
    try {
      await onSalir()
    } finally {
      router.replace(RUTAS.club(slugNegocio))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-white drop-shadow">Esta cuenta es de otro local</p>
      <p className="text-sm text-white/85">
        La sesión guardada en este teléfono es de otro negocio, así que no podemos mostrarte la
        tarjeta de este club.
      </p>
      <button
        type="button"
        onClick={() => void cambiar()}
        disabled={saliendo}
        className={buttonVariants({ className: 'min-h-12' })}
      >
        {saliendo ? 'Saliendo…' : 'Cambiar de cuenta'}
      </button>
      <Link href={RUTAS.club(slugNegocio)} className="text-sm text-white/80 underline underline-offset-4">
        Ir al club de este local
      </Link>
    </div>
  )
}
