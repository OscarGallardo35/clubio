import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { GoogleService } from '../google/google.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { getPagination, paginar } from '../common/utils/pagination.util';
import type { FiltrarResenasDto } from './dto/resenas.dto';

const CACHE_TTL = 300; // 5 min
/** En la vista publica solo se muestran resenas de 3 estrellas o mas. */
const MIN_ESTRELLAS_PUBLICO = 3;

export interface ResenaCtx {
  empleadoId: string; rol: string; ip?: string;
}

@Injectable()
export class ResenasService {
  private readonly logger = new Logger('Resenas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
    private readonly google: GoogleService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Vista publica (QR / landing): solo >= 3 estrellas.
   * Cacheada en Redis 5 min: es la ruta mas golpeada por visitantes anonimos.
   */
  async listarPublico(negocioSlug: string) {
    if (!negocioSlug) throw new NotFoundException('Falta el tenant (X-Tenant-Slug)');

    const clave = `resenas:publico:${negocioSlug.toLowerCase()}`;
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) {
      return { ...JSON.parse(cacheado), cacheado: true };
    }

    const negocio = await this.prisma.negocio.findUnique({
      where: { slug: negocioSlug.toLowerCase() },
      select: { id: true, nombre: true, slug: true },
    });
    if (!negocio) throw new NotFoundException('Negocio no encontrado');

    const [data, total, agregado] = await Promise.all([
      this.prisma.resenaGoogle.findMany({
        where: { negocioId: negocio.id, estrellas: { gte: MIN_ESTRELLAS_PUBLICO } },
        orderBy: { fechaResena: 'desc' },
        take: 20,
        select: {
          id: true, autorNombre: true, autorFotoUrl: true, estrellas: true,
          texto: true, fechaResena: true, respondida: true, respuestaTexto: true,
        },
      }),
      this.prisma.resenaGoogle.count({
        where: { negocioId: negocio.id, estrellas: { gte: MIN_ESTRELLAS_PUBLICO } },
      }),
      this.prisma.resenaGoogle.aggregate({
        where: { negocioId: negocio.id }, _avg: { estrellas: true }, _count: { _all: true },
      }),
    ]);

    const respuesta = {
      negocio: { id: negocio.id, nombre: negocio.nombre, slug: negocio.slug },
      promedio: Number((agregado._avg.estrellas ?? 0).toFixed(2)),
      totalResenas: agregado._count._all,
      minEstrellasMostradas: MIN_ESTRELLAS_PUBLICO,
      total,
      data,
      cacheado: false,
    };

    await this.redis.set(clave, JSON.stringify(respuesta), CACHE_TTL).catch(() => undefined);
    return respuesta;
  }

  async listarAdmin(negocioId: string, filtros: FiltrarResenasDto) {
    const { page, pageSize, skip, take } = getPagination(filtros);
    const where: Prisma.ResenaGoogleWhereInput = { negocioId };
    if (filtros.estrellas) where.estrellas = filtros.estrellas;
    if (filtros.respondida !== undefined) where.respondida = filtros.respondida === 'true';
    if (filtros.desde || filtros.hasta) {
      where.fechaResena = {
        ...(filtros.desde ? { gte: new Date(filtros.desde) } : {}),
        ...(filtros.hasta ? { lte: new Date(filtros.hasta) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.resenaGoogle.findMany({
        where, orderBy: { fechaResena: 'desc' }, skip, take,
        include: { respuestaEmpleado: { select: { id: true, nombre: true } } },
      }),
      this.prisma.resenaGoogle.count({ where }),
    ]);
    return paginar(data, total, page, pageSize);
  }

  /** Sincroniza desde Google (OAuth o fallback Places) e idempotente por reviewId. */
  async sincronizar(negocioId: string, ctx?: ResenaCtx) {
    const { origen, motivo, resenas } = await this.google.obtenerResenasDeGoogle(negocioId);

    let creadas = 0;
    let actualizadas = 0;
    for (const r of resenas) {
      const existente = await this.prisma.resenaGoogle.findUnique({
        where: { negocioId_reviewId: { negocioId, reviewId: r.reviewId } },
        select: { id: true },
      });
      await this.prisma.resenaGoogle.upsert({
        where: { negocioId_reviewId: { negocioId, reviewId: r.reviewId } },
        update: {
          autorNombre: r.autorNombre, autorFotoUrl: r.autorFotoUrl ?? null,
          estrellas: r.estrellas, texto: r.texto ?? null, fechaResena: r.fechaResena,
        },
        create: {
          negocioId, reviewId: r.reviewId, autorNombre: r.autorNombre,
          autorFotoUrl: r.autorFotoUrl ?? null, estrellas: r.estrellas,
          texto: r.texto ?? null, fechaResena: r.fechaResena,
        },
      });
      if (existente) actualizadas++; else creadas++;
    }

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'resena.sincronizada', empleadoId: ctx?.empleadoId,
      detalle: { origen, creadas, actualizadas, motivo },
      ip: ctx?.ip,
    });

    return { origen, motivo, total: resenas.length, creadas, actualizadas };
  }

  /** Responde una reseña (se guarda local; la publicacion en Google es del Prompt #7). */
  async responder(negocioId: string, resenaId: string, texto: string, ctx: ResenaCtx) {
    const resena = await this.prisma.resenaGoogle.findFirst({
      where: { id: resenaId, negocioId }, select: { id: true },
    });
    if (!resena) throw new NotFoundException('Resena no encontrada');

    const actualizada = await this.prisma.resenaGoogle.update({
      where: { id: resenaId },
      data: {
        respuestaTexto: texto,
        respondida: true,
        respuestaEmpleadoId: ctx.empleadoId,
      },
      select: { id: true, respondida: true, respuestaTexto: true },
    });

    await this.invalidarCachePorNegocioId(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'resena.respondida', empleadoId: ctx.empleadoId,
      detalle: { resenaId }, ip: ctx.ip,
    });
    return actualizada;
  }

  /**
   * Webhook de Google Pub/Sub.
   *
   * 1. Valida el token compartido con timingSafeEqual.
   * 2. Idempotencia por `messageId` via WebhooksService (WebhookLog unique).
   * 3. Dispara la sincronizacion.
   *
   * Google reintenta agresivamente: la idempotencia es obligatoria.
   */
  async procesarWebhookPubSub(body: Record<string, any>, tokenRecibido?: string) {
    this.google.verificarTokenPubSub(tokenRecibido);

    const message = body?.message ?? {};
    const messageId = message.messageId ?? body?.messageId;
    if (!messageId) {
      return { ok: false, motivo: 'payload sin messageId' };
    }

    const yaProcesado = await this.webhooks.procesar('google_pubsub', messageId, body);
    if (yaProcesado) {
      return { ok: true, duplicado: true, messageId };
    }

    // El payload real viene en base64 dentro de message.data
    let negocioId: string | undefined;
    try {
      const decodificado = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'))
        : {};
      negocioId = decodificado.negocioId ?? decodificado.name?.match(/\/([^/]+)$/)?.[1];
    } catch {
      this.logger.warn(`message.data no decodificable en ${messageId}`);
    }

    if (!negocioId) {
      return { ok: true, duplicado: false, messageId, motivo: 'sin negocioId resoluble' };
    }

    const resultado = await this.sincronizar(negocioId);
    return { ok: true, duplicado: false, messageId, negocioId, resultado };
  }

  private async invalidarCachePorNegocioId(negocioId: string) {
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { slug: true },
    });
    if (negocio) await this.invalidarCache(negocioId, negocio.slug);
  }

  private async invalidarCache(negocioId: string, slug?: string) {
    let s = slug;
    if (!s) {
      const n = await this.prisma.negocio.findUnique({ where: { id: negocioId }, select: { slug: true } });
      s = n?.slug;
    }
    if (s) await this.redis.del(`resenas:publico:${s.toLowerCase()}`).catch(() => undefined);
  }
}