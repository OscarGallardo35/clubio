import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as webpush from 'web-push';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { LimitesService } from '../planes/limites.service';
import type { EnviarPromocionDto } from './dto/enviar-promocion.dto';
import type { SuscribirPushDto } from './dto/suscribir-push.dto';
import type { CrearPlantillaDto } from './dto/crear-plantilla.dto';
import type { ActualizarPlantillaDto } from './dto/actualizar-plantilla.dto';
import type { EnviarPlantillaDto, SegmentoEnvio } from './dto/enviar-plantilla.dto';

export const COLA_PUSH = 'push-send';

/** Variables soportadas por las plantillas de push. */
export const VARIABLES_PLANTILLA = [
  'nombre',
  'negocio',
  'premio',
  'actuales',
  'meta',
  'faltantes',
  'numero',
] as const;

export interface VariablesPlantilla {
  nombre?: string;
  negocio?: string;
  premio?: string;
  actuales?: number | string;
  meta?: number | string;
  faltantes?: number | string;
  numero?: number | string;
}

/**
 * Plantillas default sugeridas (el admin puede crearlas de un toque). Viven aca
 * para que la lista de sugerencias y el seed usen la MISMA definicion.
 */
export const PLANTILLAS_DEFAULT = [
  {
    nombre: 'Sello sumado',
    titulo: '¡Sumaste un sello!',
    cuerpo: 'Llevas {{actuales}} de {{meta}}. Te faltan {{faltantes}}.',
    url: '/tarjeta',
  },
  {
    nombre: 'Premio desbloqueado',
    titulo: '¡Premio desbloqueado!',
    cuerpo: 'Mostra esta pantalla en {{negocio}} para canjear tu {{premio}}.',
    url: '/tarjeta',
  },
  {
    nombre: 'Pedido listo',
    titulo: 'Tu pedido esta listo',
    cuerpo: 'Pedido #{{numero}} listo para retirar.',
    url: '/tarjeta',
  },
] as const;

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
    private readonly limites: LimitesService,
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

  // ==========================================================================
  // URLs de los pushes
  // ==========================================================================

  /** Base de la PWA Cliente (regla de la casa: link del cliente = PUBLIC_APP_URL + slug). */
  private baseCliente(): string {
    return (process.env.PUBLIC_APP_URL ?? 'https://app.dominio.com').replace(/\/+$/, '');
  }

  /** Base de la PWA Staff (link del staff = STAFF_APP_URL + slug, igual que `construirUrlCorta`). */
  private baseStaff(): string {
    return (process.env.STAFF_APP_URL ?? 'https://staff.dominio.com').replace(/\/+$/, '');
  }

  private async slugDelNegocio(negocioId: string): Promise<string | null> {
    const n = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { slug: true },
    });
    return n?.slug ?? null;
  }

  /**
   * Normaliza la ruta de un push a una URL ABSOLUTA y con el slug del tenant.
   *
   * Regla de la casa (identica a `urlVerificacion` de visitas y a los QR de negocios):
   * el link que abre el celular es `<base>/<slug>/<ruta>`. Una ruta relativa (p. ej.
   * `/tarjeta`) NO alcanza: en una app multi-tenant resuelve por cookie/subdominio y
   * puede caer en otra pantalla o en "Todavia no tenes tarjeta".
   *
   *  - vacio/undefined -> undefined (el SW cae a su ruta por defecto; no se rompe).
   *  - ya absoluta (http/https) -> se respeta tal cual (compatibilidad).
   *  - relativa -> `<base>/<slug>/<ruta>`.
   *  - si la ruta ya trae el slug, NO se duplica.
   *  - sin slug (negocio sin slug) se degrada a `<base>/<ruta>`.
   */
  async urlDePush(
    negocioId: string,
    ruta: string | null | undefined,
    destino: 'cliente' | 'staff',
  ): Promise<string | undefined> {
    const limpia = (ruta ?? '').trim();
    if (!limpia) return undefined;
    if (/^https?:\/\//i.test(limpia)) return limpia; // absoluta cargada a mano: respetar

    const base = destino === 'cliente' ? this.baseCliente() : this.baseStaff();
    const rel = limpia.replace(/^\/+/, '');
    const slug = await this.slugDelNegocio(negocioId);

    if (!slug) return `${base}/${rel}`;
    if (rel === slug || rel.startsWith(`${slug}/`)) return `${base}/${rel}`;
    return `${base}/${slug}/${rel}`;
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
    // CAMPANAS_PUSH_MES: cuenta campanas por mes.
    await this.limites.exigirLimite(negocioId, 'CAMPANAS_PUSH_MES');

    // La URL sale ABSOLUTA y con el slug del tenant (link del cliente = PUBLIC_APP_URL + slug).
    const url = await this.urlDePush(negocioId, dto.url, 'cliente');

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
          { negocioId, destino: 'cliente', id, titulo: dto.titulo, cuerpo: dto.cuerpo, url },
          {
            attempts: 3,
            backoff: { type: 'custom' }, // 5s, 30s, 5min (ver PushProcessor.backoffStrategy)
            removeOnComplete: 500,
            removeOnFail: 1000,
          },
        ),
      ),
    );

    // Se registra la campana: es la FUENTE DE VERDAD de CAMPANAS_PUSH_MES
    // (la reconciliacion semanal cuenta filas de CampanaMarketing del periodo, asi
    // que si no se creara aca el contador se pondria en 0 el domingo).
    await this.prisma.campanaMarketing.create({
      data: {
        negocioId, titulo: dto.titulo, mensaje: dto.cuerpo,
        url: url ?? null, segmento: dto.segmento ?? 'TODOS',
        canal: 'PUSH', esAutomatizacion: false,
        enviadaEn: new Date(), totalEnviados: jobs.length,
      },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'push.promocion_encolada', empleadoId,
      detalle: { titulo: dto.titulo, segmento: dto.segmento ?? 'TODOS', destinatarios: jobs.length },
    });

    await this.limites.incrementarUso(negocioId, 'CAMPANAS_PUSH_MES');

    return { encolados: jobs.length, destinatarios: clienteIds.length };
  }

  /**
   * Envia a TODOS los empleados suscritos del negocio.
   * Con `sucursalId` solo avisa al staff de esa sucursal (multi-sucursal).
   */
  async enviarAEmpleadosDelNegocio(
    negocioId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
    sucursalId?: string | null,
  ) {
    if (!this.habilitado) return { encolados: 0, motivo: 'VAPID no configurado' };

    // Staff: link absoluto con el slug (link del staff = STAFF_APP_URL + slug).
    const url = await this.urlDePush(negocioId, payload.url, 'staff');

    const suscripciones = await this.prisma.notificacionPushEmpleado.findMany({
      where: {
        negocioId, activa: true,
        ...(sucursalId ? { empleado: { sucursalId, activo: true, eliminadoEn: null } } : {}),
      },
      select: { empleadoId: true },
      distinct: ['empleadoId'],
    });
    if (!suscripciones.length) return { encolados: 0, motivo: 'sin suscripciones' };

    const jobs = await Promise.all(
      suscripciones.map((s) =>
        this.cola.add(
          'enviar',
          { negocioId, destino: 'empleado', id: s.empleadoId, titulo: payload.title, cuerpo: payload.body, url },
          { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
        ),
      ),
    );
    return { encolados: jobs.length };
  }

  /** Envia a UN empleado concreto (#2.8: notificacion individual del pedido). */
  async enviarAEmpleado(
    negocioId: string, empleadoId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ) {
    if (!this.habilitado) return { encolados: 0, motivo: 'VAPID no configurado' };
    const activas = await this.prisma.notificacionPushEmpleado.count({
      where: { negocioId, empleadoId, activa: true },
    });
    if (!activas) return { encolados: 0, motivo: 'sin suscripciones' };

    // Staff: link absoluto con el slug (link del staff = STAFF_APP_URL + slug).
    const url = await this.urlDePush(negocioId, payload.url, 'staff');

    const job = await this.cola.add(
      'enviar',
      { negocioId, destino: 'empleado', id: empleadoId, titulo: payload.title, cuerpo: payload.body, url },
      { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { encolados: 1, jobId: job.id };
  }

  /** Envia a un cliente concreto (novedades de su pedido). */
  async enviarACliente(
    clienteId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ) {
    if (!this.habilitado) return { encolados: 0, motivo: 'VAPID no configurado' };

    const suscripciones = await this.prisma.notificacionPush.findFirst({
      where: { clienteId, activa: true },
      select: { negocioId: true },
    });
    if (!suscripciones) return { encolados: 0, motivo: 'sin suscripciones' };

    // Cliente: link absoluto con el slug del negocio al que pertenece la suscripcion.
    const url = await this.urlDePush(suscripciones.negocioId, payload.url, 'cliente');

    const job = await this.cola.add(
      'enviar',
      {
        negocioId: suscripciones.negocioId, destino: 'cliente', id: clienteId,
        titulo: payload.title, cuerpo: payload.body, url,
      },
      { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { encolados: 1, jobId: job.id };
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

  // ==========================================================================
  // PLANTILLAS DE PUSH
  // ==========================================================================

  /** Reemplaza {{var}} por su valor. Una variable sin valor se borra (no deja el {{token}}). */
  renderizar(texto: string, vars: VariablesPlantilla): string {
    return texto.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_todo, clave: string) => {
      const valor = (vars as Record<string, unknown>)[clave];
      return valor === undefined || valor === null ? '' : String(valor);
    });
  }

  /** Sugerencias de plantilla + variables soportadas (las consume el admin). */
  catalogoPlantillas() {
    return { variables: [...VARIABLES_PLANTILLA], sugeridas: PLANTILLAS_DEFAULT };
  }

  listarPlantillas(negocioId: string) {
    return this.prisma.plantillaPush.findMany({
      where: { negocioId },
      orderBy: [{ activa: 'desc' }, { creadoEn: 'asc' }],
    });
  }

  async crearPlantilla(negocioId: string, dto: CrearPlantillaDto, empleadoId?: string) {
    const plantilla = await this.prisma.plantillaPush.create({
      data: {
        negocioId,
        nombre: dto.nombre,
        titulo: dto.titulo,
        cuerpo: dto.cuerpo,
        ...(dto.icono !== undefined ? { icono: dto.icono } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
      },
    });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.plantilla_creada',
      empleadoId,
      detalle: { plantillaId: plantilla.id, nombre: plantilla.nombre },
    });
    return plantilla;
  }

  async actualizarPlantilla(
    negocioId: string,
    id: string,
    dto: ActualizarPlantillaDto,
    empleadoId?: string,
  ) {
    const existente = await this.prisma.plantillaPush.findFirst({
      where: { id, negocioId },
      select: { id: true },
    });
    if (!existente) throw new NotFoundException('Plantilla no encontrada');

    const plantilla = await this.prisma.plantillaPush.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.titulo !== undefined ? { titulo: dto.titulo } : {}),
        ...(dto.cuerpo !== undefined ? { cuerpo: dto.cuerpo } : {}),
        ...(dto.icono !== undefined ? { icono: dto.icono } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
      },
    });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.plantilla_actualizada',
      empleadoId,
      detalle: { plantillaId: plantilla.id, nombre: plantilla.nombre },
    });
    return plantilla;
  }

  async eliminarPlantilla(negocioId: string, id: string, empleadoId?: string) {
    const existente = await this.prisma.plantillaPush.findFirst({
      where: { id, negocioId },
      select: { id: true, nombre: true },
    });
    if (!existente) throw new NotFoundException('Plantilla no encontrada');
    await this.prisma.plantillaPush.delete({ where: { id } });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.plantilla_eliminada',
      empleadoId,
      detalle: { plantillaId: id, nombre: existente.nombre },
    });
    return { ok: true };
  }

  /** Configuracion resuelta para armar las variables de una campana. */
  private async contextoPlantilla(negocioId: string) {
    const [negocio, cfg] = await Promise.all([
      this.prisma.negocio.findUnique({ where: { id: negocioId }, select: { nombre: true } }),
      this.prisma.configuracionClub.findUnique({
        where: { negocioId },
        select: { sellosParaPremio: true, premioTexto: true },
      }),
    ]);
    return {
      nombreNegocio: negocio?.nombre ?? 'el local',
      meta: cfg?.sellosParaPremio ?? 0,
      premioTexto: cfg?.premioTexto ?? 'tu premio',
    };
  }

  /**
   * Datos de EJEMPLO (un cliente real del negocio si hay, si no placeholders) para
   * previsualizar y para la prueba a un dispositivo.
   */
  async datosEjemplo(negocioId: string) {
    const { nombreNegocio, meta, premioTexto } = await this.contextoPlantilla(negocioId);
    const cliente = await this.prisma.cliente.findFirst({
      where: { negocioId, eliminadoEn: null },
      orderBy: { creadoEn: 'asc' },
      select: { nombre: true, sellosActuales: true },
    });
    const actuales = cliente?.sellosActuales ?? Math.max(1, Math.floor(meta / 2));
    return {
      nombre: cliente?.nombre ?? 'Cliente de ejemplo',
      negocio: nombreNegocio,
      premio: premioTexto,
      actuales,
      meta,
      faltantes: Math.max(0, meta - actuales),
      numero: '1042',
    } satisfies VariablesPlantilla;
  }

  /**
   * Destinatarios de un segmento: solo clientes con una suscripcion push activa.
   * - TODOS: todos los suscritos.
   * - PREMIO_DESBLOQUEADO: sellosActuales >= meta.
   * - INACTIVO_30: sin visita hace mas de 30 dias (incluye a los que nunca vinieron).
   */
  private async destinatariosDeSegmento(negocioId: string, segmento: SegmentoEnvio, meta: number) {
    const base: Prisma.NotificacionPushWhereInput = {
      negocioId,
      activa: true,
      cliente: { eliminadoEn: null },
    };
    if (segmento === 'PREMIO_DESBLOQUEADO') {
      base.cliente = { eliminadoEn: null, sellosActuales: { gte: meta } };
    } else if (segmento === 'INACTIVO_30') {
      const corte = new Date(Date.now() - 30 * 86_400_000);
      base.cliente = {
        eliminadoEn: null,
        OR: [{ ultimaVisita: { lt: corte } }, { ultimaVisita: null }],
      };
    }

    const subs = await this.prisma.notificacionPush.findMany({
      where: base,
      select: {
        clienteId: true,
        cliente: { select: { nombre: true, sellosActuales: true } },
      },
    });

    // Dedupe por cliente (un cliente puede tener varios dispositivos suscritos).
    const porCliente = new Map<string, { id: string; nombre: string; sellosActuales: number }>();
    for (const s of subs) {
      if (!porCliente.has(s.clienteId)) {
        porCliente.set(s.clienteId, {
          id: s.clienteId,
          nombre: s.cliente.nombre,
          sellosActuales: s.cliente.sellosActuales,
        });
      }
    }
    return [...porCliente.values()];
  }

  /**
   * Envia una plantilla. Con `endpoint` es una PRUEBA a ese dispositivo; sin el,
   * una campana por `segmento` a todos los suscritos del segmento.
   */
  async enviarConPlantilla(negocioId: string, dto: EnviarPlantillaDto, empleadoId?: string) {
    this.exigirVapid();

    const plantilla = await this.prisma.plantillaPush.findFirst({
      where: { id: dto.plantillaId, negocioId },
    });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

    const ctx = await this.contextoPlantilla(negocioId);
    const titulo = dto.titulo ?? plantilla.titulo;
    const cuerpo = dto.cuerpo ?? plantilla.cuerpo;
    const url = dto.url ?? plantilla.url ?? undefined;

    // --- Prueba a UN dispositivo ---
    if (dto.endpoint) {
      const vars = await this.datosEjemplo(negocioId);
      const [cliente, empleado] = await Promise.all([
        this.prisma.notificacionPush.findFirst({
          where: { endpoint: dto.endpoint, activa: true },
          select: { id: true, endpoint: true, auth: true, p256dh: true },
        }),
        this.prisma.notificacionPushEmpleado.findFirst({
          where: { endpoint: dto.endpoint, activa: true },
          select: { id: true, endpoint: true, auth: true, p256dh: true },
        }),
      ]);
      const sub = cliente ?? empleado;
      if (!sub) throw new NotFoundException('Ese dispositivo no tiene una suscripcion activa');

      // El dispositivo puede ser de un cliente o de un empleado: la base del link depende de eso.
      const urlDestino = await this.urlDePush(
        negocioId,
        url ? this.renderizar(url, vars) : undefined,
        cliente ? 'cliente' : 'staff',
      );

      try {
        await this.enviarAPayload(sub, {
          title: this.renderizar(titulo, vars),
          body: this.renderizar(cuerpo, vars),
          url: urlDestino,
          icon: plantilla.icono ?? undefined,
          timestamp: Date.now(),
        });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.desuscribir(sub.endpoint);
          throw new BadRequestException('La suscripcion de ese dispositivo ya no es valida');
        }
        throw e;
      }

      await this.auditoria.registrar({
        negocioId,
        accion: 'push.prueba_enviada',
        empleadoId,
        detalle: { plantillaId: plantilla.id, endpoint: sub.endpoint.slice(0, 60) },
      });
      return { prueba: true, enviados: 1 };
    }

    // --- Campana por segmento ---
    if (!dto.segmento) {
      throw new BadRequestException('Indica un segmento o un endpoint de prueba');
    }
    await this.limites.exigirLimite(negocioId, 'CAMPANAS_PUSH_MES');

    const destinatarios = await this.destinatariosDeSegmento(negocioId, dto.segmento, ctx.meta);
    // Campana a clientes: el link sale absoluto y con el slug del tenant.
    const urlCampana = await this.urlDePush(negocioId, url, 'cliente');

    const jobs = await Promise.all(
      destinatarios.map((c) => {
        const vars: VariablesPlantilla = {
          nombre: c.nombre,
          negocio: ctx.nombreNegocio,
          premio: ctx.premioTexto,
          actuales: c.sellosActuales,
          meta: ctx.meta,
          faltantes: Math.max(0, ctx.meta - c.sellosActuales),
          numero: '',
        };
        return this.cola.add(
          'enviar',
          {
            negocioId,
            destino: 'cliente',
            id: c.id,
            titulo: this.renderizar(titulo, vars),
            cuerpo: this.renderizar(cuerpo, vars),
            ...(urlCampana ? { url: this.renderizar(urlCampana, vars) } : {}),
          },
          { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
        );
      }),
    );

    await this.prisma.campanaMarketing.create({
      data: {
        negocioId,
        titulo,
        mensaje: cuerpo,
        url: urlCampana ?? null,
        segmento: dto.segmento,
        canal: 'PUSH',
        esAutomatizacion: false,
        enviadaEn: new Date(),
        totalEnviados: jobs.length,
      },
    });

    await this.auditoria.registrar({
      negocioId,
      accion: 'push.plantilla_encolada',
      empleadoId,
      detalle: {
        plantillaId: plantilla.id,
        segmento: dto.segmento,
        destinatarios: destinatarios.length,
      },
    });

    await this.limites.incrementarUso(negocioId, 'CAMPANAS_PUSH_MES');

    return { encolados: jobs.length, destinatarios: destinatarios.length };
  }
}