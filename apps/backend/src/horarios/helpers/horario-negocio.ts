import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ahoraArgentina, AR_OFFSET_MS, horaAMinutos, aHoraArgentina } from '../../push/disparos.service';

/**
 * LOGICA PURA de los horarios del local. No toca la DB ni Nest: recibe la grilla ya
 * normalizada + un `Date` ("ahora") y devuelve el estado. Es la unica funcion que
 * interpreta horas, y la cubren los unit tests con `ahora` inyectado.
 *
 * El servicio (`HorariosService.estaAbierto`) es el unico consumidor: nadie mas compara
 * horas en el backend (fuente unica de verdad).
 *
 * Forma del JSON de una grilla semanal:
 *
 *   { "lun": [{ "desde": "12:00", "hasta": "15:00" }], "mar": [], ... }
 *
 * - 0..N rangos por dia (12-15 y 20-24 conviven).
 * - Un rango que CRUZA medianoche se escribe con `hasta` <= `desde` (20:00 -> 02:00) y
 *   pertenece al dia ANTERIOR: el tramo de 00:00 a 02:00 cuenta como lunes, no martes.
 * - `hasta: "00:00"` = hasta la medianoche de ese mismo dia (18:00-00:00).
 * - Dia AUSENTE o con lista vacia = CERRADO ese dia.
 * - El objeto VACIO (`{}`) NO es una grilla: significa "sin override" (null).
 */

export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type DiaSemana = (typeof DIAS)[number];

export const ETIQUETA_DIA: Record<DiaSemana, string> = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miercoles', jue: 'Jueves',
  vie: 'Viernes', sab: 'Sabado', dom: 'Domingo',
};

/** `ahoraArgentina().semana` viene en ingles (getUTCDay); aca se mapea al indice 0=lun. */
const DIA_POR_SEMANA: Record<string, DiaSemana> = {
  MONDAY: 'lun', TUESDAY: 'mar', WEDNESDAY: 'mie', THURSDAY: 'jue',
  FRIDAY: 'vie', SATURDAY: 'sab', SUNDAY: 'dom',
};

export interface RangoHorario {
  desde: string;
  hasta: string;
}

export type HorarioSemana = Partial<Record<DiaSemana, RangoHorario[]>>;

export type MotivoHorario =
  /** No hay grilla configurada: el local esta SIEMPRE abierto (default de los tenants). */
  | 'SIN_HORARIOS'
  /** Dentro de una franja. */
  | 'DENTRO_DE_HORARIO'
  /** Fuera de todas las franjas del dia (y no arrastra ninguna de ayer). */
  | 'FUERA_DE_HORARIO'
  /** Configuro grilla y HOY no tiene ninguna franja. */
  | 'SIN_HORARIO_DEL_DIA'
  /** Feriado / cierre temporal (ExcepcionHorario). */
  | 'EXCEPCION';

export interface EstadoHorario {
  abierto: boolean;
  /** UTC en que vuelve a abrir. `null` si ya esta abierto o si no hay proxima apertura conocida. */
  proximaApertura: Date | null;
  /** Minutos hasta el cierre de la franja vigente. `null` si esta cerrado. */
  cierraEnMin: number | null;
  motivo: MotivoHorario;
}

export interface OpcionesEvaluacion {
  /** Dias (YYYY-MM-DD, hora ARGENTINA) cerrados por excepcion. */
  diasCerrados?: Set<string>;
}

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_DIA = 1440;

export function esHoraValida(valor: unknown): valor is string {
  return typeof valor === 'string' && RE_HORA.test(valor);
}

/**
 * Valor de Prisma para una grilla ya validada: `Prisma.DbNull` (DB NULL, que `findUnique`
 * devuelve como `null`) cuando NO hay override, o el JSON tal cual. Vive aca (y no en el
 * servicio) para que `ConfiguracionService` no importe `HorariosService` y no se arme un
 * ciclo de imports.
 */
export function grillaAValorPrisma(
  normalizado: HorarioSemana | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return normalizado === null ? Prisma.DbNull : (normalizado as unknown as Prisma.InputJsonValue);
}

function esRangoValido(r: unknown): r is RangoHorario {
  return !!r && typeof r === 'object'
    && esHoraValida((r as RangoHorario).desde)
    && esHoraValida((r as RangoHorario).hasta);
}

/**
 * Normaliza el JSON crudo de una grilla SIN tirar: descarta lo invalido y devuelve
 * `null` cuando NO hay override efectivo (null/undefined/no-objeto/`{}`).
 *
 * Se usa para LEER (configEfectiva puede traer cualquier cosa), no para escribir: el
 * input del admin se valida con `validarGrilla`.
 */
export function normalizarHorarioSemana(valor: unknown): HorarioSemana | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return null;
  const obj = valor as Record<string, unknown>;
  const salida: HorarioSemana = {};
  let tieneDias = false;
  for (const dia of DIAS) {
    if (!(dia in obj)) continue;
    tieneDias = true;
    const rangos = Array.isArray(obj[dia]) ? (obj[dia] as unknown[]) : [];
    salida[dia] = rangos.filter(esRangoValido).map((r) => ({ desde: r.desde, hasta: r.hasta }));
  }
  return tieneDias ? salida : null;
}

/**
 * Valida el input del admin y lo normaliza. TIRA 400 si la forma es invalida (dia
 * desconocido, rango que no es lista, hora con formato malo, desde === hasta).
 * Devuelve `null` para el objeto vacio / null (sin override).
 */
export function validarGrilla(valor: unknown, etiqueta = 'horarios'): HorarioSemana | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw new BadRequestException(`${etiqueta}: se espera un objeto con un dia de la semana por clave`);
  }
  const obj = valor as Record<string, unknown>;
  const claves = Object.keys(obj);
  if (claves.length === 0) return null; // {} = sin override
  const salida: HorarioSemana = {};
  for (const clave of claves) {
    if (!(DIAS as readonly string[]).includes(clave)) {
      throw new BadRequestException(`${etiqueta}: dia invalido "${clave}" (usar ${DIAS.join(', ')})`);
    }
    const rangos = obj[clave];
    if (!Array.isArray(rangos)) {
      throw new BadRequestException(`${etiqueta}: los rangos de "${clave}" deben ser una lista`);
    }
    salida[clave as DiaSemana] = rangos.map((r) => {
      const desde = (r as RangoHorario)?.desde;
      const hasta = (r as RangoHorario)?.hasta;
      if (!esHoraValida(desde) || !esHoraValida(hasta)) {
        throw new BadRequestException(`${etiqueta}: hora invalida en "${clave}" (formato HH:mm)`);
      }
      if (desde === hasta) {
        throw new BadRequestException(`${etiqueta}: en "${clave}", desde y hasta no pueden ser iguales`);
      }
      return { desde, hasta };
    });
  }
  return salida;
}

/** Indice 0=lun..6=dom del dia ARGENTINO de `ahora`. */
function indiceDiaAr(ahora: Date): number {
  const { semana } = ahoraArgentina(ahora);
  const dia = DIA_POR_SEMANA[semana] ?? 'lun';
  return DIAS.indexOf(dia);
}

/** 'YYYY-MM-DD' + n dias (aritmetica UTC pura, sin TZ del proceso). */
export function sumarDiasAr(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out = new Date(base + n * 86_400_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${out.getUTCFullYear()}-${p(out.getUTCMonth() + 1)}-${p(out.getUTCDate())}`;
}

/** Hora de pared ARGENTINA ('YYYY-MM-DD' + minutos) -> `Date` UTC. */
export function utcDeHoraArgentina(fecha: string, minutos: number): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  const h = Math.floor(minutos / 60);
  const mi = minutos % 60;
  return new Date(Date.UTC(y, m - 1, d, h, mi) + AR_OFFSET_MS);
}

/** Rango [desde, hasta) en minutos. Si cruza medianoche, `hasta` es del dia siguiente. */
function minutosDe(r: RangoHorario): { a: number; b: number; cruza: boolean } {
  const a = horaAMinutos(r.desde) ?? 0;
  const b = horaAMinutos(r.hasta) ?? 0;
  return { a, b, cruza: b <= a };
}

/**
 * Proxima apertura (UTC) a partir de `ar` (hoy en AR). Recorre hasta 8 dias; `null` si
 * la grilla no abre nunca (o solo tiene dias cerrados por excepcion).
 */
function proximaApertura(
  horario: HorarioSemana,
  fechaHoy: string,
  idxHoy: number,
  minutos: number,
  cerrados: Set<string>,
): Date | null {
  for (let off = 0; off <= 8; off++) {
    const fecha = sumarDiasAr(fechaHoy, off);
    if (cerrados.has(fecha)) continue; // el dia entero esta cerrado
    const idx = (idxHoy + off) % 7;
    const rangos = horario[DIAS[idx]] ?? [];
    const ordenados = rangos
      .map((r) => ({ ...r, a: horaAMinutos(r.desde) ?? 0 }))
      .sort((x, y) => x.a - y.a);
    for (const r of ordenados) {
      // Hoy: solo una franja que TODAVIA no abrio cuenta.
      if (off === 0 && r.a <= minutos) continue;
      return utcDeHoraArgentina(fecha, r.a);
    }
  }
  return null;
}

/**
 * Estado del local para UNA grilla (atencion o delivery). `ahora` es inyectable: los
 * tests no dependen de la hora real.
 */
export function evaluarHorario(
  horario: HorarioSemana | null,
  ahora: Date,
  opciones: OpcionesEvaluacion = {},
): EstadoHorario {
  const cerrados = opciones.diasCerrados ?? new Set<string>();

  // Sin grilla configurada = siempre abierto. Es lo que protege a los tenants que hoy
  // no tienen horarios (que-lomitos, bar-la-esquina).
  if (!horario) {
    return { abierto: true, proximaApertura: null, cierraEnMin: null, motivo: 'SIN_HORARIOS' };
  }

  const ar = ahoraArgentina(ahora);
  const { fecha, minutos: m } = ar;
  const idxHoy = indiceDiaAr(ahora);

  // Excepcion (feriado / cierre temporal): el dia entero esta cerrado.
  if (cerrados.has(fecha)) {
    return {
      abierto: false,
      proximaApertura: proximaApertura(horario, fecha, idxHoy, m, cerrados),
      cierraEnMin: null,
      motivo: 'EXCEPCION',
    };
  }

  const rangosHoy = horario[DIAS[idxHoy]] ?? [];

  // Franja de HOY que contiene `m`.
  for (const r of rangosHoy) {
    const { a, b, cruza } = minutosDe(r);
    if (!cruza && m >= a && m < b) {
      return { abierto: true, proximaApertura: null, cierraEnMin: b - m, motivo: 'DENTRO_DE_HORARIO' };
    }
    if (cruza && m >= a) {
      // Empieza hoy y termina manana a las `b`: el tramo que queda es hasta `b` de manana.
      return { abierto: true, proximaApertura: null, cierraEnMin: MIN_DIA - m + b, motivo: 'DENTRO_DE_HORARIO' };
    }
  }

  // Franja de AYER que cruzaba medianoche y todavia corre hoy (00:00..hasta).
  const idxAyer = (idxHoy + 6) % 7;
  for (const r of horario[DIAS[idxAyer]] ?? []) {
    const { b, cruza } = minutosDe(r);
    if (cruza && m < b) {
      return { abierto: true, proximaApertura: null, cierraEnMin: b - m, motivo: 'DENTRO_DE_HORARIO' };
    }
  }

  return {
    abierto: false,
    proximaApertura: proximaApertura(horario, fecha, idxHoy, m, cerrados),
    cierraEnMin: null,
    motivo: rangosHoy.length === 0 ? 'SIN_HORARIO_DEL_DIA' : 'FUERA_DE_HORARIO',
  };
}

/**
 * Texto humano de la proxima apertura ("hoy 12:00" / "manana 12:00" / "2026-11-02 12:00"),
 * en hora ARGENTINA. `null` si no hay proxima apertura conocida.
 */
export function proximaAperturaTexto(proxima: Date | null, ahora: Date): string | null {
  if (!proxima) return null;
  const ar = ahoraArgentina(ahora);
  const iso = aHoraArgentina(proxima); // 'YYYY-MM-DDTHH:mm' en AR
  const fecha = iso.slice(0, 10);
  const hora = iso.slice(11, 16);
  if (fecha === ar.fecha) return `hoy ${hora}`;
  if (fecha === sumarDiasAr(ar.fecha, 1)) return `manana ${hora}`;
  return `${fecha} ${hora}`;
}

/**
 * Combina atencion + delivery: el delivery exige AMBAS abiertas. La proxima apertura es
 * la MAS TARDIA de las dos (el local recien esta "abierto para delivery" cuando abren las
 * dos); el cierre es el MAS TEMPRANO.
 */
export function combinarAtencionYDelivery(atencion: EstadoHorario, delivery: EstadoHorario): EstadoHorario {
  if (atencion.abierto && delivery.abierto) {
    const cierres = [atencion.cierraEnMin, delivery.cierraEnMin].filter((x): x is number => x !== null);
    return {
      abierto: true,
      proximaApertura: null,
      cierraEnMin: cierres.length ? Math.min(...cierres) : null,
      motivo: 'DENTRO_DE_HORARIO',
    };
  }
  const cerrados = [atencion, delivery].filter((e) => !e.abierto);
  const proximas = cerrados
    .map((e) => e.proximaApertura)
    .filter((d): d is Date => d instanceof Date);
  return {
    abierto: false,
    proximaApertura: proximas.length ? new Date(Math.max(...proximas.map((d) => d.getTime()))) : null,
    cierraEnMin: null,
    motivo: cerrados.some((e) => e.motivo === 'EXCEPCION') ? 'EXCEPCION' : cerrados[0]?.motivo ?? 'FUERA_DE_HORARIO',
  };
}
