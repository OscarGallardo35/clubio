'use client'

import * as React from 'react'
import { ESTADO_INICIAL, visitaReducir } from '@/lib/visita-maquina'
import type { EstadoFlujo, EventoFlujo } from '@/lib/visita-maquina'
import { configurarNegocioDeVisita, useVisitaStore } from '@/stores/visitaStore'
import { PasoRegistro } from '@/components/flujo/PasoRegistro'
import { PasoEspera } from '@/components/flujo/PasoEspera'
import { PasoConfirmado } from '@/components/flujo/PasoConfirmado'
import { PasoNoSumada } from '@/components/flujo/PasoNoSumada'
import { PasoError } from '@/components/flujo/PasoError'

const NEGOCIO = 'Bar La Esquina'
const SLUG = 'bar-la-esquina'
const META = 10
const PREMIO = 'Café gratis'
const COLORES = { colorPrimario: '#E63946', colorSecundario: '#F77F00' }
const TOKEN = 'dev-token-1234'

/** Atajos por query param: /dev/flujo?estado=esperando */
const ATAJOS: Record<string, EventoFlujo[]> = {
  inicio: [{ tipo: 'RESET' }],
  registrando: [{ tipo: 'ABRIR_REGISTRO' }],
  esperando: [
    { tipo: 'SOLICITADA', token: TOKEN, expiraEn: new Date(Date.now() + 5 * 60_000).toISOString(), sucursalId: 'suc-1' },
  ],
  aprobada: [
    { tipo: 'SOLICITADA', token: TOKEN, expiraEn: new Date(Date.now() + 5 * 60_000).toISOString(), sucursalId: 'suc-1' },
    { tipo: 'WS_APROBADA', sellosActuales: 4, premioDesbloqueado: false },
  ],
  completa: [
    { tipo: 'SOLICITADA', token: TOKEN, expiraEn: new Date(Date.now() + 5 * 60_000).toISOString(), sucursalId: 'suc-1' },
    { tipo: 'WS_APROBADA', sellosActuales: META, premioDesbloqueado: true },
  ],
  rechazada: [
    { tipo: 'SOLICITADA', token: TOKEN, expiraEn: new Date(Date.now() + 5 * 60_000).toISOString(), sucursalId: 'suc-1' },
    { tipo: 'WS_RECHAZADA', motivo: 'QR ya usado' },
  ],
  expirada: [
    { tipo: 'SOLICITADA', token: TOKEN, expiraEn: new Date(Date.now() + 60_000).toISOString(), sucursalId: 'suc-1' },
    { tipo: 'EXPIRAR' },
  ],
  yaSumada: [{ tipo: 'SOLICITUD_RECHAZADA', motivo: 'yaSumadaHoy' }],
  espera4h: [{ tipo: 'SOLICITUD_RECHAZADA', motivo: 'esperaHoras', faltanHoras: 4 }],
  error: [{ tipo: 'ERROR_RED', mensaje: 'No pudimos conectar con el local.' }],
}

function aplicar(eventos: EventoFlujo[]): EstadoFlujo {
  return eventos.reduce<EstadoFlujo>((e, ev) => visitaReducir(e, ev), { ...ESTADO_INICIAL })
}

export function DevFlujo() {
  const [flujo, setFlujo] = React.useState<EstadoFlujo>({ ...ESTADO_INICIAL })
  const [motivoRechazo, setMotivoRechazo] = React.useState('QR ya usado')
  const [remontaje, setRemontaje] = React.useState(0)
  const [atajo, setAtajo] = React.useState<string | null>(null)

  const despachar = (e: EventoFlujo) => setFlujo((f) => visitaReducir(f, e))

  // Atajo por query param (revision visual sin navegar).
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const estado = q.get('estado')
    if (!estado || !ATAJOS[estado]) return
    setAtajo(estado)
    setFlujo(aplicar(ATAJOS[estado]))
  }, [remontaje])

  /**
   * Cierre y reapertura REAL: se escribe el token en el persist de verdad
   * (clave visita_<slug>), se rehidrata el store y se llama a hidratar(). El
   * flujo tiene que volver en 'esperando' sin que nadie lo pida.
   */
  const simularCierreYReapertura = () => {
    configurarNegocioDeVisita(SLUG)
    useVisitaStore.setState({
      token: TOKEN,
      expiraEn: new Date(Date.now() + 5 * 60_000).toISOString(),
      sucursalId: 'suc-1',
      flujo: { ...ESTADO_INICIAL },
    })
    void Promise.resolve(useVisitaStore.persist.rehydrate()).then(() => {
      useVisitaStore.getState().hidratar()
      const f = useVisitaStore.getState().flujo
      // El resume de verdad ademas consulta el estado; en dev se simula PENDIENTE.
      setFlujo(visitaReducir(f, { tipo: 'ESTADO_RECIBIDO', estado: 'PENDIENTE' }))
    })
  }

  const actuales = flujo.sellos?.sellosActuales ?? 3
  const comun = { nombreNegocio: NEGOCIO, ...COLORES, premioTexto: PREMIO, meta: META }

  return (
    <div className="min-h-dvh bg-[linear-gradient(160deg,#E63946,#F77F00)] pb-10">
      <div className="mx-auto max-w-md p-3">
        <p className="mb-2 rounded-xl bg-black/25 px-3 py-2 text-center text-xs text-white">
          dev/flujo · paso: <b>{flujo.paso}</b>
          {flujo.motivo ? ` (${flujo.motivo})` : ''}
          {atajo ? ` · atajo: ${atajo}` : ''}
        </p>
      </div>

      {/* key: remonta el subarbol para probar el arranque limpio */}
      <div key={remontaje}>
        {(flujo.paso === 'inicio' || flujo.paso === 'registrando' || flujo.paso === 'solicitando') && (
          <PasoRegistro
            {...comun}
            actuales={actuales}
            premioDesbloqueado={false}
            nombreCliente={null}
            autenticado={false}
            cargando={false}
            onRegistrar={() => despachar({ tipo: 'SOLICITAR' })}
            onSumar={() => despachar({ tipo: 'SOLICITAR' })}
          />
        )}
        {flujo.paso === 'esperando' && flujo.token && (
          <PasoEspera
            token={flujo.token}
            expiraEn={flujo.expiraEn}
            ws="conectado"
            numeroAtendiente="+5491100000000"
            mensajeWhatsApp="Hola, quiero sumar mi visita"
            onCancelar={() => despachar({ tipo: 'RESET' })}
          />
        )}
        {flujo.paso === 'aprobada' && (
          <PasoConfirmado
            {...comun}
            actuales={actuales}
            premioDesbloqueado={flujo.sellos?.premioDesbloqueado ?? false}
            nombreCliente="Ana"
            mostrarResena
            placeId="ChIJdev"
            onVerTarjeta={() => undefined}
            onVolver={() => despachar({ tipo: 'RESET' })}
          />
        )}
        {flujo.paso === 'noSumada' && (
          <PasoNoSumada
            motivo={flujo.motivo}
            texto={flujo.motivo === 'rechazada' ? 'El local no pudo validar tu visita.' : null}
            onReintentar={() => despachar({ tipo: 'REINTENTAR' })}
            onVerTarjeta={() => undefined}
            onVolverMenu={() => despachar({ tipo: 'RESET' })}
          />
        )}
        {flujo.paso === 'error' && (
          <PasoError mensaje={flujo.mensaje} onReintentar={() => despachar({ tipo: 'REINTENTAR' })} onVolverMenu={() => despachar({ tipo: 'RESET' })} />
        )}
      </div>

      {/* --- simuladores --- */}
      <div className="mx-auto mt-6 grid max-w-md gap-2 p-3">
        <p className="text-center text-xs font-semibold text-white/90">Simuladores</p>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.aprobada ?? []))}>
          Simular aprobación
        </button>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.completa ?? []))}>
          Simular aprobación con premio
        </button>
        <div className="flex gap-2">
          <select
            className="min-h-11 flex-1 rounded-xl bg-white/95 px-3 text-sm"
            value={motivoRechazo}
            onChange={(e) => setMotivoRechazo(e.target.value)}
            aria-label="Motivo del rechazo"
          >
            <option>QR ya usado</option>
            <option>Fuera del horario del local</option>
            <option>El código no es de este local</option>
          </select>
          <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
            onClick={() => setFlujo(aplicar([...(ATAJOS.esperando ?? []), { tipo: 'WS_RECHAZADA', motivo: motivoRechazo }]))}>
            Simular rechazo
          </button>
        </div>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.expirada ?? []))}>
          Simular expiración
        </button>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.yaSumada ?? []))}>
          Simular ya sumó
        </button>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.espera4h ?? []))}>
          Simular espera de 4 horas
        </button>
        <button className="min-h-11 rounded-xl bg-white/95 px-3 text-sm font-medium"
          onClick={() => setFlujo(aplicar(ATAJOS.error ?? []))}>
          Simular error de red
        </button>
        <button className="min-h-11 rounded-xl bg-foreground px-3 text-sm font-semibold text-background"
          onClick={simularCierreYReapertura}>
          Simular cierre y reapertura (persist real)
        </button>
        <button className="min-h-11 rounded-xl bg-white/20 px-3 text-sm font-medium text-white"
          onClick={() => { setAtajo(null); setFlujo({ ...ESTADO_INICIAL }); setRemontaje((n) => n + 1) }}>
          Reset
        </button>
        <p className="mt-1 text-center text-[11px] leading-snug text-white/80">
          Atajos por URL: ?estado=inicio · registrando · esperando · aprobada · completa · rechazada · expirada · yaSumada · espera4h · error
        </p>
      </div>
    </div>
  )
}
