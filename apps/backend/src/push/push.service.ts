import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { EnviarPromocionDto } from './dto/enviar-promocion.dto';
import type { SuscribirPushDto } from './dto/suscribir-push.dto';

export const COLA_PUSH = 'push-send';

/** Payload que viaja en el job de BullMQ. */
export interface PushJob {
  negocioId: string;
  /** Destinatario: un cliente o un empleado. */
  destino: 'cliente' | 'empleado';
  id: string;
  titulo: string;
  cuerpo: string;
  url?: string;
  campanaId?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  private readonly vapidPublicKey: string;
  private readonly vapidPrivada: string;
  private readonly habilitado: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    @InjectQueue(COLA_PUSH) private readonly cola: Queue<PushJob>,
  ) {
    this.vapidPublicKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim();
    this.vapidPrivada = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
    this.habilitado = !!this.vapidPublicKey && !!this.vapidPrivada;

    if (this.habilitado) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT ?? 'mailto:admin@dominio.com',
        this.vapidPublicKey,
        this.vapidPrivada,
      );
      this.logger.log('Web Push configurado con VAPID');
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY vacias: el envio de push queda deshabilitado. ' +
        'Generar con: npx web-push generate-vapid-keys',
      );
    }
  }

  /** GET /push/vapid-public-key (publico): la PWA necesita esta clave para suscribirse. */
  vapidPublica() {
    return { publicKey: this.vapidPublicKey, habilitado: this.habilitado };
  }

  private exigirVapid() {
    if (!this.habilitado) {
      throw new BadRequestException(
        'Web Push no configurado: faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY',
      );
    }
  }

  /** Suscribe un CLIENTE (upsert por endpoint: un endpoint es de un solo dispositivo). */
  async suscribirCliente(negocioId: string, clienteId: string, dto: SuscribirPushDto) {
    this.exigirVapid();
    const suscripcion = await this.prisma.notificacionPush.upsert({
      where: { endpoint: dto.endpoint },
      update: { auth: dto.keys.auth, p256dh: dto.keys.p256dh, activa: true, ultimoUso: new Date() },
      create: {
        negocioId, clienteId,
        endpoint: dto.endpoint, auth: dto.keys.auth, p256dh: dto.keys.p256dh,
      },
      select: { id: true, endpoint: true, activa: true },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'push.suscrito', clienteId,
      detalle: { endpoint: dto.endpoint.slice(0, 60) },
    });
    return suscripcion;
  }

  /** Suscribe un EMPLEADO (avisos de visitas pendientes en la PWA Staff). */
  async suscribirEmpleado(negocioId: string, empleadoId: string, dto: SuscribirPushDto) {
    this.exigirVapid();
    const suscripcion = await this.prisma.notificacionPushEmpleado.upsert({
      where: { endpoint: dto.endpoint },
      update: { auth: dto.keys.auth, p256dh: dto.keys.p256dh, activa: true, ultimoUso: new Date() },
      create: {
        negocioId, empleadoId,
        endpoint: dto.endpoint, auth: dto.keys.auth, p256dh: dto.keys.p256dh,
      },
      select: { id: true, endpoint: true, activa: true },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'push.suscrito', empleadoId,
      detalle: { endpoint: dto.endpoint.slice(0, 60) },
    });
    return suscripcion;
  }

  async desuscribir(endpoint: string) {
    const [c, e] = await Promise.all([
      this.prisma.notificacionPush.updateMany({ where: { endpoint }, data: { activa: false } }),
      this.prisma.notificacionPushEmpleado.updateMany({ where: { endpoint }, data: { activa: false } }),
    ]);
    return { desactivadas: c.count + e.count };
  }

  /** GET /push/suscripciones: cuantas tiene el negocio (diagnostico). */
  async resumen(negocioId: string) {
    const [clientes, empleados] = await Promise.all([
      this.prisma.notificacionPush.count({ where: { negocioId, activa: true } }),
      this.prisma.notificacionPushEmpleado.count({ where: { negocioId, activa: true } }),
    ]);
    return { clientes, empleados };
  }

  /**
   * Envia una promocion: resuelve destinatarios y ENCOLA un job por cada uno.
   * La API responde al instante; el procesador los manda en background.
   */
  async enviarPromocion(negocioId: string, dto: EnviarPromocionDto, empleadoId?: string) {
    this.exigirVapid();

    let clienteIds: string[];
    if (dto.clienteIds?.length) {
      const propios = await this.prisma.cliente.findMany({
        where: { negocioId, eliminadoEn: null, id: { in: dto.clienteIds } },
        select: { id: true },
      });
      clienteIds = propios.map((c) => c.id);
      if (!clienteIds.length) throw new NotFoundException('Ninguno de esos clientes es del negocio');
    } else {
      const suscripciones = await this.prisma.notificacionPush.findMany({
        where: {
          negocioId, activa: true,
          ...(dto.segmento && dto.segmento !== 'TODOS'
            ? { cliente: { etiqueta: dto.segmento as never, eliminadoEn: null } }
            : { cliente: { eliminadoEn: null } }),
        },
        select: { clienteId: true },
        distinct: ['clienteId'],
      });
      clienteIds = suscripciones.map((s) => s.clienteId);
    }

    const jobs = await Promise.all(
      clienteIds.map((id) =>
        this.cola.add(
          'enviar',
          { negocioId, destino: 'cliente', id, titulo: dto.titulo, cuerpo: dto.cuerpo, url: dto.url },
          {
            attempts: 3,
            backoff: { type: 'custom' }, // 5s, 30s, 5min (ver PushProcessor.backoffStrategy)
            removeOnComplete: 500,
            removeOnFail: 1000,
          },
        ),
      ),
    );

    await this.auditoria.registrar({
      negocioId, accion: 'push.promocion_encolada', empleadoId,
      detalle: { titulo: dto.titulo, segmento: dto.segmento ?? 'TODOS', destinatarios: jobs.length },
    });

    return { encolados: jobs.length, destinatarios: clienteIds.length };
  }

  /** Encola un aviso puntual (lo usa el flujo de visitas). */
  async encolarAvisoStaff(negocioId: string, empleadoId: string, titulo: string, cuerpo: string) {
    if (!this.habilitado) return { encolados: 0, motivo: 'VAPID no configurado' };
    const activas = await this.prisma.notificacionPushEmpleado.count({
      where: { negocioId, empleadoId, activa: true },
    });
    if (!activas) return { encolados: 0, motivo: 'sin suscripciones' };

    const job = await this.cola.add(
      'enviar',
      { negocioId, destino: 'empleado', id: empleadoId, titulo, cuerpo },
      { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { encolados: 1, jobId: job.id };
  }

  /** Envio efectivo de UN payload (lo llama el processor). */
  async enviarAPayload(suscripcion: { endpoint: string; auth: string; p256dh: string }, data: object) {
    return webpush.sendNotification(
      { endpoint: suscripcion.endpoint, keys: { auth: suscripcion.auth, p256dh: suscripcion.p256dh } },
      JSON.stringify(data),
    );
  }

  /** Suscripciones activas de un destinatario. */
  async suscripcionesDe(destino: 'cliente' | 'empleado', id: string) {
    if (destino === 'cliente') {
      return this.prisma.notificacionPush.findMany({
        where: { clienteId: id, activa: true },
        select: { id: true, endpoint: true, auth: true, p256dh: true },
      });
    }
    return this.prisma.notificacionPushEmpleado.findMany({
      where: { empleadoId: id, activa: true },
      select: { id: true, endpoint: true, auth: true, p256dh: true },
    });
  }

  /** Marca una suscripcion como muerta (410/404 = el navegador la revoco). */
  async desactivarSuscripcion(destino: 'cliente' | 'empleado', id: string) {
    if (destino === 'cliente') {
      await this.prisma.notificacionPush.update({ where: { id }, data: { activa: false } });
    } else {
      await this.prisma.notificacionPushEmpleado.update({ where: { id }, data: { activa: false } });
    }
  }

  async registrarResultado(negocioId: string, ok: boolean, detalle: Record<string, unknown>) {
    await this.auditoria.registrar({
      negocioId,
      accion: ok ? 'push.enviado' : 'push.fallido',
      detalle,
    });
  }
}