import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampanaPush, EstadoCampanaPush, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { LimitesService } from '../planes/limites.service';
import { PushService, COLA_PUSH } from './push.service';
import {
  AR_OFFSET_MS,
  COLA_DISPAROS,
  ahoraArgentina,
  fechaArgentinaAUtc,
  horaAMinutos,
} from './disparos.service';
import type { PushJob, PublicoResuelto } from './push.service';
import type { CrearCampanaDto } from './dto/crear-campana.dto';
import type { ActualizarCampanaDto } from './dto/actualizar-campana.dto';
import type { PreviewCampanaDto } from './dto/preview-campana.dto';
import type { ProbarCampanaDto } from './dto/probar-campana.dto';

/**
 * CAMPAÑAS DE PUSH PROGRAMABLES.
 *
 * Diseño (ver el comentario del modelo `CampanaPush` en schema.prisma):
 *  - El estado vive en Postgres (`PROGRAMADA`/`ENVIANDO`/`ENVIADA`/`CANCELADA`), NO
 *    en jobs demorados de BullMQ: programar para dentro de una semana no debe dejar
 *    miles de jobs demorados en Redis (presion de cuota).
 *  - El DISPATCHER es un job repeatable con id fijo (`upsertJobScheduler` en
 *    `DisparosProcessor`) que re-escanea `programadoPara <= now AND estado =
 *    PROGRAMADA`. Es IDEMPOTENTE: reclama la fila con un `updateMany` atomico
 *    (PROGRAMADA -> ENVIANDO), asi un reinicio (o dos instancias) no reenvia.
 *  - El PUBLICO se re-resuelve al ENVIAR (no se congela al crear), pero las
 *    EXCLUSIONES se respetan SIEMPRE y SOLO RECORTAN. Por eso el "N de M" del
 *    preview es una ESTIMACION.
 *  - La CUOTA `CAMPANAS_PUSH_MES` se RESERVA AL CREAR. CANCELAR una campaña
 *    PROGRAMADA DEVUELVE EL CUPO.
 *  - `programadoPara` se guarda en UTC y se convierte desde la hora ARGENTINA de
 *    pared (`fechaArgentinaAUtc`); la UI siempre muestra en AR.
 */

/** Job repeatable del dispatcher (mismo nombre de cola que los disparos). */
export const JOB_CAMPANAS = 'campanas';

/**
 * Una campaña reclamada (`ENVIANDO`) cuya ultima escritura es mas vieja que esto se
 * considera COLGADA (el proceso murio a mitad del despacho) y se REANUDA. Reanudar
 * es seguro: el despacho salta a los destinatarios que ya tienen su fila en
 * `EnvioPushLog`.
 */
export const CAMPANA_STALE_MS = 15 * 60_000;

/** Tope de campañas despachadas por tick (una corrida no debe ser eterna). */
const MAX_POR_TICK = 50;

interface Exclusiones {
  clientes: string[];
  segmentos: string[];
}

export interface StatsCampana {
  total: number;
  encolados: number;
  enviados: number;
  fallidos: number;
  sinSuscripcion: number;
  suprimidos: number;
}

const STATS_VACIOS: StatsCampana = {
  total: 0,
  encolados: 0,
  enviados: 0,
  fallidos: 0,
  sinSuscripcion: 0,
  suprimidos: 0,
};

/** Lee `exclusiones` sin asumir la forma (puede venir null). */
function leerExclusiones(valor: unknown): Exclusiones {
  const o = (valor ?? {}) as { clientes?: unknown; segmentos?: unknown };
  return {
    clientes: Array.isArray(o.clientes) ? (o.clientes.filter((x) => typeof x === 'string') as string[]) : [],
    segmentos: Array.isArray(o.segmentos) ? (o.segmentos.filter((x) => typeof x === 'string') as string[]) : [],
  };
}

/** Etiqueta legible del estado (para el 409 y la auditoria). */
function etiquetaEstado(estado: EstadoCampanaPush): string {
  switch (estado) {
    case 'PROGRAMADA':
      return 'programada';
    case 'ENVIANDO':
      return 'enviando (ya salio)';
    case 'ENVIADA':
      return 'enviada';
    case 'CANCELADA':
      return 'cancelada';
  }
}

@Injectable()
export class CampanasPushService {
  private readonly logger = new Logger('CampanasPush');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly limites: LimitesService,
    private readonly auditoria: AuditoriaService,
    @InjectQueue(COLA_PUSH) private readonly colaPush: Queue<PushJob>,
    @InjectQueue(COLA_DISPAROS) private readonly colaDisparos: Queue,
  ) {}

  // ==========================================================================
  // CRUD (lo consume el admin)
  // ==========================================================================

  /** Lista las campañas del negocio con el estado y "a cuantos les llego" (n/m). */
  async listar(negocioId: string) {
    const campanas = await this.prisma.campanaPush.findMany({
      where: { negocioId },
      orderBy: [{ programadoPara: 'desc' }, { creadoEn: 'desc' }],
    });
    const stats = await this.statsPorCampana(
      negocioId,
      campanas.map((c) => c.campanaId).filter((x): x is string => !!x),
    );
    return {
      data: campanas.map((c) => ({ ...c, stats: c.campanaId ? (stats.get(c.campanaId) ?? STATS_VACIOS) : STATS_VACIOS })),
      total: campanas.length,
    };
  }

  /** Detalle de UNA campaña (mismo shape que la lista). */
  async obtener(negocioId: string, id: string) {
    const c = await this.exigirPropia(negocioId, id);
    const stats = await this.statsPorCampana(negocioId, c.campanaId ? [c.campanaId] : []);
    return { ...c, stats: c.campanaId ? (stats.get(c.campanaId) ?? STATS_VACIOS) : STATS_VACIOS };
  }

  /**
   * ALCANCE antes de confirmar ("N de M"). Es una ESTIMACION: la base se re-resuelve
   * al momento del envio. El `desglose` dice cuantos suscritos hay en el segmento,
   * cuantos recorta una exclusion y cuantos clientes del negocio no tienen push.
   */
  async preview(negocioId: string, dto: PreviewCampanaDto) {
    const publico = await this.push.resolverPublico(negocioId, {
      segmento: dto.segmento ?? 'TODOS',
      excluirClienteIds: dto.excluirClienteIds ?? [],
      excluirSegmentos: dto.excluirSegmentos ?? [],
    });
    return {
      alcanzables: publico.alcanzables.length,
      total: publico.total,
      desglose: publico.desglose,
      /** El numero es una estimacion (la UI lo dice con esas palabras). */
      estimacion: true as const,
    };
  }

  /**
   * Crea (PROGRAMA) una campaña. RESERVA la cuota del mes al CREAR, no al enviar:
   * con programacion, verificar al enviar dejaria programar 10 el dia 31 y reventar
   * el mes siguiente (o bajar de plan entre medio).
   */
  async crear(negocioId: string, dto: CrearCampanaDto, empleadoId?: string) {
    this.push.exigirPushConfigurado();

    const programadoPara = fechaArgentinaAUtc(dto.programadoPara);
    if (!programadoPara) {
      throw new BadRequestException("Fecha y hora invalidas (se espera 'YYYY-MM-DDTHH:mm')");
    }
    if (dto.plantillaId) await this.exigirPlantilla(negocioId, dto.plantillaId);

    // Reserva de cupo AL CREAR (ver el comentario del modelo).
    await this.limites.exigirLimite(negocioId, 'CAMPANAS_PUSH_MES');

    const segmento = dto.segmento ?? 'TODOS';
    const url = dto.url?.trim() ? dto.url.trim() : null;
    const icono = dto.icono?.trim() ? dto.icono.trim() : null;
    const exclusiones = this.exclusionesDe(dto.excluirClienteIds, dto.excluirSegmentos);

    const campana = await this.prisma.$transaction(async (tx) => {
      // La CampanaMarketing se crea JUNTO con la campaña: es la que cuelga de
      // `EnvioPushLog.campanaId` y la que cuenta la reconciliacion semanal del uso.
      // `enviadaEn` queda null hasta el despacho, asi no aparece en el Historial
      // (que lista campañas con envios) hasta que realmente sale.
      const mk = await tx.campanaMarketing.create({
        data: {
          negocioId,
          titulo: dto.titulo,
          mensaje: dto.cuerpo,
          url,
          segmento,
          canal: 'PUSH',
          esAutomatizacion: false,
          enviadaEn: null,
          totalEnviados: 0,
        },
        select: { id: true },
      });
      return tx.campanaPush.create({
        data: {
          negocioId,
          nombre: dto.nombre,
          titulo: dto.titulo,
          cuerpo: dto.cuerpo,
          url,
          icono,
          plantillaId: dto.plantillaId ?? null,
          segmento,
          ...(exclusiones ? { exclusiones: exclusiones as unknown as Prisma.InputJsonValue } : {}),
          programadoPara,
          campanaId: mk.id,
        },
      });
    });

    await this.limites.incrementarUso(negocioId, 'CAMPANAS_PUSH_MES');
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.campana_programada',
      empleadoId,
      detalle: {
        campanaPushId: campana.id,
        campanaId: campana.campanaId,
        segmento,
        programadoPara: programadoPara.toISOString(),
      },
    });

    // Programada para AHORA (o para el pasado): se despierta el dispatcher para que
    // salga en segundos en vez de esperar el tick de 1 minuto.
    if (programadoPara.getTime() <= Date.now()) await this.despertarDisparador();

    return campana;
  }

  /**
   * REPROGRAMA (o edita el mensaje/publico de) una campaña. SOLO se permite mientras
   * esta `PROGRAMADA`: si ya salio (`ENVIANDO`/`ENVIADA`) o se cancelo, responde 409.
   */
  async actualizar(negocioId: string, id: string, dto: ActualizarCampanaDto, empleadoId?: string) {
    const c = await this.exigirPropia(negocioId, id);
    if (c.estado !== 'PROGRAMADA') {
      throw new ConflictException(
        `La campaña ya esta ${etiquetaEstado(c.estado)}: no se puede reprogramar`,
      );
    }

    let programadoPara = c.programadoPara;
    if (dto.programadoPara !== undefined) {
      const f = fechaArgentinaAUtc(dto.programadoPara);
      if (!f) throw new BadRequestException("Fecha y hora invalidas (se espera 'YYYY-MM-DDTHH:mm')");
      programadoPara = f;
    }

    const actual = leerExclusiones(c.exclusiones);
    const tocaExclusiones = dto.excluirClienteIds !== undefined || dto.excluirSegmentos !== undefined;
    const exclusiones = tocaExclusiones
      ? this.exclusionesDe(
          dto.excluirClienteIds ?? actual.clientes,
          dto.excluirSegmentos ?? actual.segmentos,
        )
      : null;

    const urlNueva = dto.url !== undefined ? (dto.url.trim() ? dto.url.trim() : null) : undefined;

    const actualizada = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.campanaPush.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
          ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
          ...(dto.cuerpo !== undefined ? { cuerpo: dto.cuerpo } : {}),
          ...(urlNueva !== undefined ? { url: urlNueva } : {}),
          ...(dto.icono !== undefined ? { icono: dto.icono.trim() ? dto.icono.trim() : null } : {}),
          ...(dto.segmento !== undefined ? { segmento: dto.segmento } : {}),
          ...(tocaExclusiones
            ? { exclusiones: exclusiones ? (exclusiones as unknown as Prisma.InputJsonValue) : Prisma.JsonNull }
            : {}),
          programadoPara,
        },
      });

      // El historial lee de CampanaMarketing: si cambio el mensaje, se refleja ahi.
      if (
        c.campanaId &&
        (dto.titulo !== undefined ||
          dto.cuerpo !== undefined ||
          urlNueva !== undefined ||
          dto.segmento !== undefined)
      ) {
        await tx.campanaMarketing.update({
          where: { id: c.campanaId },
          data: {
            ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
            ...(dto.cuerpo !== undefined ? { mensaje: dto.cuerpo } : {}),
            ...(urlNueva !== undefined ? { url: urlNueva } : {}),
            ...(dto.segmento !== undefined ? { segmento: dto.segmento } : {}),
          },
        });
      }
      return upd;
    });

    await this.auditoria.registrar({
      negocioId,
      accion: 'push.campana_reprogramada',
      empleadoId,
      detalle: { campanaPushId: id, programadoPara: programadoPara.toISOString() },
    });

    if (programadoPara.getTime() <= Date.now()) await this.despertarDisparador();
    return actualizada;
  }

  /**
   * CANCELA una campaña. SOLO mientras esta `PROGRAMADA` (si ya salio: 409).
   *
   * DEVUELVE EL CUPO: como la campaña nunca salio, se borra su `CampanaMarketing`
   * (sin envios) y se decrementa `CAMPANAS_PUSH_MES`. Si la campaña se cancelara con
   * envios ya escritos NO se tocaria el cupo (no pasa: solo se cancela PROGRAMADA).
   */
  async cancelar(negocioId: string, id: string, motivo?: string, empleadoId?: string) {
    const c = await this.exigirPropia(negocioId, id);
    if (c.estado !== 'PROGRAMADA') {
      throw new ConflictException(
        `La campaña ya esta ${etiquetaEstado(c.estado)}: no se puede cancelar`,
      );
    }

    await this.prisma.campanaPush.update({
      where: { id },
      data: { estado: 'CANCELADA', motivoCancelacion: motivo?.trim() ? motivo.trim() : null },
    });

    let cupoDevuelto = false;
    if (c.campanaId) {
      const envios = await this.prisma.envioPushLog.count({ where: { campanaId: c.campanaId } });
      if (envios === 0) {
        // El FK `onDelete: SetNull` deja `CampanaPush.campanaId` en null solo.
        await this.prisma.campanaMarketing
          .deleteMany({ where: { id: c.campanaId } })
          .catch(() => undefined);
        await this.limites.decrementarUso(negocioId, 'CAMPANAS_PUSH_MES').catch(() => undefined);
        cupoDevuelto = true;
      }
    }

    await this.auditoria.registrar({
      negocioId,
      accion: 'push.campana_cancelada',
      empleadoId,
      detalle: { campanaPushId: id, cupoDevuelto, motivo: motivo ?? null },
    });

    return { ok: true, cupoDevuelto };
  }

  /** "PROBAR A MI MISMO": manda los textos en edicion al dispositivo del que la pide. */
  async probar(negocioId: string, dto: ProbarCampanaDto, empleadoId?: string) {
    const r = await this.push.probarEnDispositivo(negocioId, {
      endpoint: dto.endpoint,
      titulo: dto.titulo,
      cuerpo: dto.cuerpo,
      ...(dto.url ? { url: dto.url } : {}),
      ...(dto.icono ? { icono: dto.icono } : {}),
    });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.campana_probada',
      empleadoId,
      detalle: { endpoint: dto.endpoint.slice(0, 60) },
    });
    return r;
  }

  // ==========================================================================
  // DISPATCHER
  // ==========================================================================

  /**
   * Re-escanea las campañas vencidas y las despacha. Lo llaman:
   *  - el job repeatable `campanas` (cada minuto, ver DisparosProcessor);
   *  - `POST /push/campanas/tick` (tick forzado del harness / del admin).
   *
   * IDEMPOTENTE: reclama cada fila con un `updateMany` atomico antes de encolar, asi
   * un reinicio no reenvia. Tambien REANUDA las que quedaron colgadas en `ENVIANDO`.
   */
  async evaluarProgramadas(negocioId?: string, base: Date = new Date()) {
    const where: Prisma.CampanaPushWhereInput = {
      ...(negocioId ? { negocioId } : {}),
      OR: [
        { estado: 'PROGRAMADA', programadoPara: { lte: base } },
        { estado: 'ENVIANDO', actualizadoEn: { lt: new Date(base.getTime() - CAMPANA_STALE_MS) } },
      ],
    };
    const campanas = await this.prisma.campanaPush.findMany({
      where,
      orderBy: { programadoPara: 'asc' },
      take: MAX_POR_TICK,
    });

    let enviadas = 0;
    const resultados: Array<{ id: string; estado: string; motivo?: string }> = [];
    for (const c of campanas) {
      const r = await this.despacharUno(c, base);
      resultados.push(r);
      if (r.estado === 'ENVIADA') enviadas++;
    }
    if (campanas.length) {
      this.logger.log(`Campanas evaluadas: ${campanas.length}, despachadas: ${enviadas}`);
    }
    return { evaluadas: campanas.length, enviadas, resultados };
  }

  /** Despacha UNA campaña (con el claim, la ventana horaria y el manejo de error). */
  private async despacharUno(c: CampanaPush, base: Date) {
    // 1) VENTANA HORARIA: si cae fuera, se DIFIERE a la proxima apertura (nunca se descarta).
    const proxima = await this.proximaApertura(base, c.negocioId);
    if (proxima) {
      await this.prisma.campanaPush.updateMany({
        where: { id: c.id, estado: { in: ['PROGRAMADA', 'ENVIANDO'] } },
        data: { estado: 'PROGRAMADA', programadoPara: proxima },
      });
      await this.auditoria.registrar({
        negocioId: c.negocioId,
        accion: 'push.campana_diferida',
        detalle: { campanaPushId: c.id, programadoPara: proxima.toISOString() },
      });
      return {
        id: c.id,
        estado: 'PROGRAMADA',
        motivo: `fuera de la ventana horaria: diferida a ${proxima.toISOString()}`,
      };
    }

    // 2) CLAIM atomico (solo si esta PROGRAMADA): si otro despacho la gano, se saltea.
    if (c.estado === 'PROGRAMADA') {
      const claim = await this.prisma.campanaPush.updateMany({
        where: { id: c.id, estado: 'PROGRAMADA' },
        data: { estado: 'ENVIANDO' },
      });
      if (claim.count !== 1) return { id: c.id, estado: c.estado, motivo: 'ya reclamada por otro despacho' };
    }

    // 3) Despacho real. Es REANUDABLE: salta a los que ya tienen su fila en el historial.
    try {
      const r = await this.despachar(c, base);
      return { id: c.id, estado: 'ENVIADA', motivo: r.motivo };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`Fallo el despacho de la campana ${c.id}: ${msg}`);
      // Vuelve a PROGRAMADA: el tick siguiente la retoma (y el despacho es reanudable,
      // asi no se duplica a quien ya se encolo).
      await this.prisma.campanaPush
        .updateMany({ where: { id: c.id, estado: 'ENVIANDO' }, data: { estado: 'PROGRAMADA' } })
        .catch(() => undefined);
      return { id: c.id, estado: 'PROGRAMADA', motivo: `error: ${msg}` };
    }
  }

  /** Resuelve el publico (con exclusiones) y encola los jobs. Reanudable. */
  private async despachar(c: CampanaPush, base: Date) {
    if (!c.campanaId) throw new Error('La campaña no tiene CampanaMarketing asociada');

    const ctx = await this.push.contextoPlantilla(c.negocioId);
    const ex = leerExclusiones(c.exclusiones);
    const publico = await this.push.resolverPublico(c.negocioId, {
      segmento: c.segmento,
      excluirClienteIds: ex.clientes,
      excluirSegmentos: ex.segmentos,
    });

    // Reanudable: lo que ya tiene fila en el historial NO se vuelve a encolar.
    const filas = await this.prisma.envioPushLog.findMany({
      where: { campanaId: c.campanaId },
      select: { clienteId: true },
    });
    const ya = new Set(filas.map((f) => f.clienteId).filter((x): x is string => !!x));

    const nuevos = publico.alcanzables.filter((d) => !ya.has(d.id));
    if (!nuevos.length) {
      await this.finalizar(c, base);
      return { encolados: 0, motivo: 'sin destinatarios nuevos' };
    }

    // Link del cliente: absoluto y con el slug. Se resuelve UNA vez y se renderiza por cliente.
    const urlBase = await this.push.urlDePush(c.negocioId, c.url, 'cliente');

    const seeds: Prisma.EnvioPushLogCreateManyInput[] = [];
    for (const d of nuevos) {
      const vars = {
        nombre: d.nombre,
        negocio: ctx.nombreNegocio,
        premio: ctx.premioTexto,
        actuales: d.sellosActuales,
        meta: ctx.meta,
        faltantes: Math.max(0, ctx.meta - d.sellosActuales),
        numero: '',
      };
      const job = await this.colaPush.add(
        'enviar',
        {
          negocioId: c.negocioId,
          destino: 'cliente',
          id: d.id,
          titulo: this.push.renderizar(c.titulo, vars),
          cuerpo: this.push.renderizar(c.cuerpo, vars),
          ...(urlBase ? { url: this.push.renderizar(urlBase, vars) } : {}),
          campanaId: c.campanaId,
        },
        {
          // jobId determinista: un reintento/reanudacion no duplica el job en BullMQ.
          jobId: `cp-${c.campanaId}-${d.id}`,
          attempts: 3,
          backoff: { type: 'custom' },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      );
      seeds.push({
        negocioId: c.negocioId,
        estado: 'ENCOLADO',
        campanaId: c.campanaId,
        campanaTitulo: c.titulo,
        clienteId: d.id,
        segmento: c.segmento,
        jobId: job.id === undefined || job.id === null ? null : String(job.id),
      });
    }

    // Historial: una fila ENCOLADO por destinatario (el procesador la completa).
    await this.prisma.envioPushLog.createMany({ data: seeds });

    // El historial explica POR QUE alguien no recibio: fila SUPRIMIDO_EXCLUIDO con motivo.
    const suprimidos = publico.excluidosDetalle.filter((x) => !ya.has(x.id));
    if (suprimidos.length) {
      await this.prisma.envioPushLog.createMany({
        data: suprimidos.map((x) => ({
          negocioId: c.negocioId,
          estado: 'SUPRIMIDO_EXCLUIDO',
          campanaId: c.campanaId,
          campanaTitulo: c.titulo,
          clienteId: x.id,
          segmento: c.segmento,
          motivo: x.motivo,
        })),
      });
    }

    await this.finalizar(c, base);

    await this.auditoria.registrar({
      negocioId: c.negocioId,
      accion: 'push.campana_enviada',
      detalle: {
        campanaPushId: c.id,
        campanaId: c.campanaId,
        encolados: seeds.length,
        suprimidos: suprimidos.length,
        suscritos: publico.desglose.suscritos,
      },
    });

    return { encolados: seeds.length, suprimidos: suprimidos.length };
  }

  /** Marca la campaña como ENVIADA y sella `enviadaEn` (una sola vez). */
  private async finalizar(c: CampanaPush, base: Date) {
    await this.prisma.campanaPush.update({
      where: { id: c.id },
      data: { estado: 'ENVIADA', enviadaEn: base },
    });
    if (c.campanaId) {
      await this.prisma.campanaMarketing
        .updateMany({
          where: { id: c.campanaId, enviadaEn: null },
          data: { enviadaEn: base },
        })
        .catch(() => undefined);
    }
  }

  /**
   * La VENTANA HORARIA del negocio (hora ARGENTINA). `null` si la campaña puede
   * salir AHORA; si no, la fecha UTC de la proxima apertura (nunca se descarta).
   *
   * Sin ventana configurada (default: los dos campos vacios) NO cambia nada.
   */
  private async proximaApertura(ahora: Date, negocioId: string): Promise<Date | null> {
    const cfg = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { pushVentanaInicio: true, pushVentanaFin: true },
    });
    const ini = horaAMinutos(cfg?.pushVentanaInicio ?? '');
    const fin = horaAMinutos(cfg?.pushVentanaFin ?? '');
    if (ini === null || fin === null) return null; // sin ventana: comportamiento actual

    const ar = ahoraArgentina(ahora);
    const m = ar.minutos;
    // Ventana normal (ini <= fin) o que cruza medianoche (20:00 - 02:00).
    const dentro = ini <= fin ? m >= ini && m < fin : m >= ini || m < fin;
    if (dentro) return null;

    const [y, mo, d] = ar.fecha.split('-').map(Number);
    const inicioHoyUtc = new Date(Date.UTC(y, mo - 1, d, Math.floor(ini / 60), ini % 60) + AR_OFFSET_MS);
    // Todavia no abrio hoy -> hoy; ya cerro -> manana (la ventana de un dia termina
    // antes de su proximo inicio, tambien en el caso que cruza medianoche).
    if (m < ini) return inicioHoyUtc;
    return new Date(inicioHoyUtc.getTime() + 86_400_000);
  }

  // ==========================================================================
  // INTERNOS
  // ==========================================================================

  /** Despierta el dispatcher (best-effort): un nudge para no esperar el tick. */
  private async despertarDisparador() {
    try {
      await this.colaDisparos.add(
        JOB_CAMPANAS,
        {},
        { jobId: 'campanas-now', removeOnComplete: true, removeOnFail: 100 },
      );
    } catch (e) {
      // Redis caido: el tick repeatable la va a levantar igual en ~1 minuto.
      this.logger.warn(`No se pudo despertar el dispatcher de campañas: ${(e as Error).message}`);
    }
  }

  /** `null` si no hay exclusiones (no se escribe la columna). */
  private exclusionesDe(clientes?: string[], segmentos?: string[]): Exclusiones | null {
    const c = [...new Set((clientes ?? []).filter((x) => typeof x === 'string' && x))];
    const s = [...new Set((segmentos ?? []).filter((x) => typeof x === 'string' && x))];
    return c.length || s.length ? { clientes: c, segmentos: s } : null;
  }

  /** Resumen por campaña desde `EnvioPushLog` (fuente de verdad, no contadores). */
  private async statsPorCampana(negocioId: string, campanaIds: string[]) {
    const mapa = new Map<string, StatsCampana>();
    if (!campanaIds.length) return mapa;

    const grupos = await this.prisma.envioPushLog.groupBy({
      by: ['campanaId', 'estado'],
      where: { negocioId, campanaId: { in: campanaIds } },
      _count: { _all: true },
    });
    for (const g of grupos) {
      if (!g.campanaId) continue;
      const acc = mapa.get(g.campanaId) ?? { ...STATS_VACIOS };
      const n = g._count._all;
      acc.total += n;
      if (g.estado === 'ENCOLADO') acc.encolados += n;
      else if (g.estado === 'ENVIADO') acc.enviados += n;
      else if (g.estado === 'FALLIDO') acc.fallidos += n;
      else if (g.estado === 'SIN_SUSCRIPCION') acc.sinSuscripcion += n;
      else if (g.estado === 'SUPRIMIDO_EXCLUIDO') acc.suprimidos += n;
      mapa.set(g.campanaId, acc);
    }
    return mapa;
  }

  private async exigirPropia(negocioId: string, id: string): Promise<CampanaPush> {
    const c = await this.prisma.campanaPush.findFirst({ where: { id, negocioId } });
    if (!c) throw new NotFoundException('Campaña no encontrada');
    return c;
  }

  private async exigirPlantilla(negocioId: string, plantillaId: string) {
    const p = await this.prisma.plantillaPush.findFirst({
      where: { id: plantillaId, negocioId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
  }

  /**
   * Publico RESUELTO de una campaña (para tests/diagnostico). No lo consume la UI.
   */
  async publicoDe(negocioId: string, id: string): Promise<PublicoResuelto> {
    const c = await this.exigirPropia(negocioId, id);
    const ex = leerExclusiones(c.exclusiones);
    return this.push.resolverPublico(negocioId, {
      segmento: c.segmento,
      excluirClienteIds: ex.clientes,
      excluirSegmentos: ex.segmentos,
    });
  }
}
