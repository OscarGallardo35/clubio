/**
 * Horarios del local en el NAVEGADOR.
 *
 * Misma semantica que `HorariosService.estaAbierto` del backend (fuente de verdad), pero
 * re-evaluada en el cliente para no sondear el backend (el throttler es 100 req/60 s por IP:
 * cada 10 s no seria razonable). La zona horaria se resuelve con `Intl` en
 * `America/Argentina/Buenos_Aires`, NUNCA con la hora local del dispositivo (un turista con el
 * telefono en otra TZ tiene que ver el horario del local).
 *
 * Es SOLO informativo: el POST /pedidos sigue chequeando en el backend.
 */
import type { ExcepcionHorario, HorarioSemana, RangoHorario } from '@/types/api'

const ORDEN = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const
type Dia = (typeof ORDEN)[number]

const ABREV_A_DIA: Record<string, Dia> = {
  Mon: 'lun', Tue: 'mar', Wed: 'mie', Thu: 'jue', Fri: 'vie', Sat: 'sab', Sun: 'dom',
}

const NOMBRE_DIA: Record<Dia, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miercoles', jue: 'jueves',
  vie: 'viernes', sab: 'sabado', dom: 'domingo',
}

export interface MomentoAr {
  /** YYYY-MM-DD en hora argentina. */
  fecha: string
  /** Minutos desde las 00:00 en hora argentina. */
  minutos: number
  /** 0 = lunes .. 6 = domingo. */
  diaIdx: number
}

/** "Ahora" en hora argentina, derivado con `Intl` (independiente de la TZ del dispositivo). */
export function momentoAr(base: Date = new Date()): MomentoAr {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(base)
  const p: Record<string, string> = {}
  for (const x of partes) p[x.type] = x.value
  const diaIdx = ORDEN.indexOf(ABREV_A_DIA[p.weekday ?? 'Mon'] ?? 'lun')
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    diaIdx,
  }
}

function sumarDias(fecha: string, n: number): string {
  const [y = 0, m = 1, d = 1] = fecha.split('-').map(Number)
  const out = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${out.getUTCFullYear()}-${p(out.getUTCMonth() + 1)}-${p(out.getUTCDate())}`
}

/** `ORDEN` indexado de forma segura (el tsconfig del cliente usa noUncheckedIndexedAccess). */
function diaEn(idx: number): Dia {
  return ORDEN[((idx % 7) + 7) % 7] ?? 'lun'
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function esRangoValido(r: unknown): r is RangoHorario {
  const x = r as RangoHorario
  return !!x && typeof x.desde === 'string' && typeof x.hasta === 'string'
}

/** `{}` / null = sin horarios. Un dia presente con lista vacia = cerrado. */
export function normalizarGrilla(v: unknown): HorarioSemana | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const obj = v as Record<string, unknown>
  const salida: HorarioSemana = {}
  let hay = false
  for (const dia of ORDEN) {
    if (!(dia in obj)) continue
    hay = true
    const rangos = Array.isArray(obj[dia]) ? (obj[dia] as unknown[]).filter(esRangoValido) : []
    salida[dia] = rangos.map((r) => ({ desde: r.desde, hasta: r.hasta }))
  }
  return hay ? salida : null
}

function diasCerrados(excepciones: ExcepcionHorario[] | undefined, fecha: string): Set<string> {
  const set = new Set<string>()
  for (const e of excepciones ?? []) {
    const ini = String(e?.desdeFecha ?? '').slice(0, 10)
    const fin = String(e?.hastaFecha ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) continue
    // Se expande solo lo relevante alrededor de hoy (evita bucles largos por un cierre mal cargado).
    let cursor = ini < sumarDias(fecha, -1) ? sumarDias(fecha, -1) : ini
    const tope = fin > sumarDias(fecha, 8) ? sumarDias(fecha, 8) : fin
    if (fin < ini) { set.add(ini); continue }
    while (cursor <= tope) {
      set.add(cursor)
      cursor = sumarDias(cursor, 1)
    }
  }
  return set
}

export interface EstadoHorarioCliente {
  abierto: boolean
  /** "hoy 12:00" / "manana 12:00" / "el viernes 12:00". `null` si no hay proxima apertura. */
  proximaTexto: string | null
  motivo: string
}

function proximaAperturaTexto(horario: HorarioSemana, momento: MomentoAr, cerrados: Set<string>): string | null {
  for (let off = 0; off <= 8; off++) {
    const fecha = sumarDias(momento.fecha, off)
    if (cerrados.has(fecha)) continue
    const idx = momento.diaIdx + off
    const rangos = [...(horario[diaEn(idx)] ?? [])].sort((a, b) => aMinutos(a.desde) - aMinutos(b.desde))
    for (const r of rangos) {
      const a = aMinutos(r.desde)
      if (off === 0 && a <= momento.minutos) continue
      const hora = r.desde
      if (fecha === momento.fecha) return `hoy ${hora}`
      if (fecha === sumarDias(momento.fecha, 1)) return `manana ${hora}`
      return `el ${NOMBRE_DIA[diaEn(idx)]} ${hora}`
    }
  }
  return null
}

/** Estado para UNA grilla (atencion o delivery). */
export function evaluarGrilla(
  horario: HorarioSemana | null,
  momento: MomentoAr,
  cerrados: Set<string>,
): EstadoHorarioCliente {
  if (!horario) return { abierto: true, proximaTexto: null, motivo: 'SIN_HORARIOS' }

  if (cerrados.has(momento.fecha)) {
    return { abierto: false, proximaTexto: proximaAperturaTexto(horario, momento, cerrados), motivo: 'EXCEPCION' }
  }

  const m = momento.minutos
  const hoy = horario[diaEn(momento.diaIdx)] ?? []

  for (const r of hoy) {
    const a = aMinutos(r.desde)
    const b = aMinutos(r.hasta)
    if (b > a && m >= a && m < b) return { abierto: true, proximaTexto: null, motivo: 'DENTRO_DE_HORARIO' }
    if (b <= a && m >= a) return { abierto: true, proximaTexto: null, motivo: 'DENTRO_DE_HORARIO' }
  }

  // Franja de AYER que cruza medianoche y todavia corre hoy.
  const ayer = horario[diaEn(momento.diaIdx + 6)] ?? []
  for (const r of ayer) {
    const a = aMinutos(r.desde)
    const b = aMinutos(r.hasta)
    if (b <= a && m < b) return { abierto: true, proximaTexto: null, motivo: 'DENTRO_DE_HORARIO' }
  }

  return {
    abierto: false,
    proximaTexto: proximaAperturaTexto(horario, momento, cerrados),
    motivo: hoy.length === 0 ? 'SIN_HORARIO_DEL_DIA' : 'FUERA_DE_HORARIO',
  }
}

/**
 * Estado del local para el cliente. `tipo` delivery exige AMBAS grillas abiertas.
 * El objeto `configuracion` es el de `NegocioPublico.configuracion`.
 */
export function calcularEstadoHorario(
  configuracion: { horariosAtencion?: unknown; horariosDelivery?: unknown } | null | undefined,
  excepciones: ExcepcionHorario[] | undefined,
  base: Date = new Date(),
  tipo: 'atencion' | 'delivery' = 'atencion',
): EstadoHorarioCliente {
  const momento = momentoAr(base)
  const cerrados = diasCerrados(excepciones, momento.fecha)
  const atencion = evaluarGrilla(normalizarGrilla(configuracion?.horariosAtencion), momento, cerrados)
  if (tipo === 'atencion') return atencion
  const delivery = evaluarGrilla(normalizarGrilla(configuracion?.horariosDelivery), momento, cerrados)
  if (atencion.abierto && delivery.abierto) return atencion
  const cerrada = !atencion.abierto ? atencion : delivery
  return { abierto: false, proximaTexto: cerrada.proximaTexto, motivo: cerrada.motivo }
}
