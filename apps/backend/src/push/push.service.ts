import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as webpush from 'web-push';
import { GeneroCliente, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { LimitesService } from '../planes/limites.service';
import { getPagination, paginar } from '../common/utils/pagination.util';
import type { EnviarPromocionDto } from './dto/enviar-promocion.dto';
import type { SuscribirPushDto } from './dto/suscribir-push.dto';
import type { CrearPlantillaDto } from './dto/crear-plantilla.dto';
import type { ActualizarPlantillaDto } from './dto/actualizar-plantilla.dto';
import type { EnviarPlantillaDto, SegmentoEnvio } from './dto/enviar-plantilla.dto';
import type { HistorialEnviosDto } from './dto/historial-envios.dto';
import { expiraDe, generarTokenPremio } from './premio.types';
import type { DescriptorPremio } from './premio.types';
import { edadALaFecha, fechaARDe } from '../common/utils/cumpleanos.util';

export const COLA_PUSH = 'push-send';

/**
 * Filtro de cliente para TODO publico de MARKETING (promos, campañas, premios y el saludo
 * de cumpleanos): vivo + con el switch "acepta notificaciones" PRENDIDO.
 *
 * Es la base del preview y del envio (fuente unica en `resolverPublico`), asi que el
 * "N de M" del admin dice exactamente a quien le va a llegar.
 *
 * NO se aplica al push TRANSACCIONAL del pedido (`pedidos.service` -> `enviarACliente`):
 * el cliente tiene que enterarse del estado de su pedido aunque haya apagado el switch.
 */
export const CLIENTE_ACEPTA: Prisma.ClienteWhereInput = {
  eliminadoEn: null,
  aceptaNotificaciones: true,
};

/** Cuantas campañas devuelve el resumen del historial de envios (`GET /push/envios/logs`). */
export const CAMPANAS_EN_RESUMEN = 20;

/** Variables soportadas por las plantillas de push. */
export const VARIABLES_PLANTILLA = [
  'nombre',
  'negocio',
  'premio',
  'actuales',
  'meta',
  'faltantes',
  'numero',
  'edad',
] as const;

export interface VariablesPlantilla {
  nombre?: string;
  negocio?: string;
  premio?: string;
  actuales?: number | string;
  meta?: number | string;
  faltantes?: number | string;
  numero?: number | string;
  /** Edad cumplida del cliente (perfilado progresivo). Sin `fechaNacimiento` no hay valor. */
  edad?: number | string;
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
  /**
   * `tag` de la notificacion: el service worker REEMPLAZA una notificacion con el
   * mismo tag y solo RE-ALERTA si el tag llega (`renotify: Boolean(tag)`). Sin tag,
   * el SW cae a `'clubio'` y TODAS las push del cliente se pisan entre si sin
   * volver a sonar. Cada emisor manda el suyo (p. ej. `disparo-<id>`, `campana-<id>`).
   */
  tag?: string;
  /** Campana que origino el envio (va en el job para que el log la pueda completar). */
  campanaId?: string;
}

/** Estados de una fila de `EnvioPushLog`. */
export type EstadoEnvioPush =
  | 'ENCOLADO'
  | 'ENVIADO'
  | 'FALLIDO'
  | 'SIN_SUSCRIPCION'
  | 'SUPRIMIDO_EXCLUIDO';

/** Resultado REAL de un endpoint, tal como lo ve el procesador (que es el unico que manda). */
export interface ResultadoEndpoint {
  endpointId: string;
  endpoint: string;
  estado: Exclude<EstadoEnvioPush, 'ENCOLADO'>;
  statusCode?: number;
  /** Motivo corto: '410', 'sin suscripcion', 'quota'. */
  motivo?: string;
  error?: string;
}

/**
 * Deltas de los contadores de una campana. Se calculan SOLO sobre las
 * transiciones reales de estado de cada fila (un reintento que vuelve a fallar no
 * suma), para que `totalEnviados`/`totalFallidos` no se inflen.
 */
export interface DeltaCampana {
  enviados: number;
  fallidos: number;
}

/** Datos minimos para escribir una fila de `EnvioPushLog` en el encolado. */
export interface EnvioEncolado {
  campanaId?: string | null;
  campanaTitulo?: string | null;
  disparoId?: string | null;
  disparoNombre?: string | null;
  clienteId?: string | null;
  empleadoId?: string | null;
  segmento?: string | null;
  jobId?: string | number | null;
}

/** Un destinatario posible: cliente con suscripcion push activa. */
export interface ClientePublico {
  id: string;
  nombre: string;
  sellosActuales: number;
  /** Perfilado progresivo: lo usa `{{edad}}` al renderizar la campana. */
  fechaNacimiento?: Date | null;
}

/** Un cliente que la base del segmento incluia pero una exclusion recorto. */
export interface ExcluidoPublico {
  id: string;
  nombre: string;
  /** Motivo legible (va al historial: explica POR QUE alguien no recibio). */
  motivo: string;
}

/** Desglose del alcance de un publico (lo que muestra el preview antes de confirmar). */
export interface DesglosePublico {
  /** M: clientes con suscripcion ACTIVA que caen en el segmento base. */
  suscritos: number;
  /** Cuantos de esos suscritos recorta una exclusion. */
  excluidos: number;
  /** Clientes del negocio (no dados de baja) SIN suscripcion push activa. */
  sinSuscripcionActiva: number;
  /**
   * Clientes del negocio (no dados de baja) con el switch "acepta notificaciones" APAGADO.
   * Tienen push, pero se autoexcluyen de TODO envio de marketing (promos, premios,
   * cumpleanos). No se cuentan como `sinSuscripcionActiva`: si tienen dispositivo.
   */
  sinAcepta: number;
  /** K: total de clientes del negocio (no dados de baja). */
  clientesNegocio: number;
}

/**
 * Publico RESUELTO de una campana. `alcanzables` es N y `total` es M ("N de M
 * suscritos"): el numero del preview es una ESTIMACION porque la base se
 * re-resuelve al enviar.
 */
export interface PublicoResuelto {
  /** N: a quienes les va a llegar (suscritos del segmento menos exclusiones). */
  alcanzables: ClientePublico[];
  /** M: suscritos del segmento base (antes de exclusiones). */
  total: number;
  desglose: DesglosePublico;
  /** Detalle de las exclusiones aplicadas (motivo incluido). */
  excluidosDetalle: ExcluidoPublico[];
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

  /**
   * Version publica de `exigirVapid` para las campañas programables: crear una
   * campaña falla temprano si el push no esta configurado (mejor que descubrirlo el
   * dia del despacho).
   */
  exigirPushConfigurado() {
    this.exigirVapid();
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

  /**
   * URL ABSOLUTA de la pagina de ACEPTAR un premio (`/<slug>/premio/<token>`).
   *
   * Regla de la casa (igual que `urlDePush` y `urlValidacion`): el servidor arma el
   * link con `PUBLIC_APP_URL` + slug, NUNCA con `window.location.origin` (en los
   * subdominios `<slug>.clubio.lat` saldria con el slug duplicado). Es la ruta propia
   * del premio: el service worker solo ENFOGA la ventana si coincide el pathname.
   */
  async urlPremio(negocioId: string, token: string): Promise<string> {
    const slug = await this.slugDelNegocio(negocioId);
    const base = this.baseCliente();
    return slug ? `${base}/${slug}/premio/${token}` : `${base}/premio/${token}`;
  }

  /**
   * URL ABSOLUTA del link de VERIFICACION/CANJE del premio en la PWA Staff
   * (`/<slug>/validar-premio?ref=<token>`). Es el mismo patron que `urlValidacion`
   * de visitas: el staff abre el link que le llega por WhatsApp y marca el canje.
   */
  async urlVerificacionPremio(negocioId: string, token: string): Promise<string> {
    const slug = await this.slugDelNegocio(negocioId);
    const base = this.baseStaff();
    return slug
      ? `${base}/${slug}/validar-premio?ref=${token}`
      : `${base}/validar-premio?ref=${token}`;
  }

  /**
   * Crea un `PremioOtorgado` PENDIENTE (NO acredita saldo) y devuelve su token, la
   * URL de aceptar y el vencimiento. Lo usan el motor de disparos y el despacho de
   * campañas; la acreditacion ocurre recien cuando el cliente ACEPTA (`PremiosService`).
   */
  async otorgarPremio(params: {
    negocioId: string;
    clienteId: string;
    descriptor: DescriptorPremio;
    disparoId?: string | null;
    disparoNombre?: string | null;
    campanaId?: string | null;
    campanaNombre?: string | null;
    sucursalId?: string | null;
  }): Promise<{ id: string; token: string; url: string; expiraEn: Date | null }> {
    const token = generarTokenPremio();
    const expiraEn = expiraDe(params.descriptor.expiraDias);
    const creado = await this.prisma.premioOtorgado.create({
      data: {
        negocioId: params.negocioId,
        clienteId: params.clienteId,
        tipo: params.descriptor.tipo,
        cantidad: params.descriptor.cantidad,
        texto: params.descriptor.texto,
        token,
        expiraEn,
        ...(params.disparoId ? { disparoId: params.disparoId } : {}),
        ...(params.campanaId ? { campanaId: params.campanaId } : {}),
        ...(params.disparoNombre ? { disparoNombre: params.disparoNombre } : {}),
        ...(params.campanaNombre ? { campanaNombre: params.campanaNombre } : {}),
        ...(params.sucursalId ? { sucursalId: params.sucursalId } : {}),
      },
      select: { id: true, token: true, expiraEn: true },
    });
    const url = await this.urlPremio(params.negocioId, creado.token);
    return { id: creado.id, token: creado.token, url, expiraEn: creado.expiraEn };
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
   *
   * Deja el historial: una fila `EnvioPushLog` ENCOLADO por destinatario (el
   * procesador la completa con el endpoint y el resultado real).
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
      const idsPedidos = propios.map((c) => c.id);
      if (!idsPedidos.length) throw new NotFoundException('Ninguno de esos clientes es del negocio');

      // Con `clienteIds` explicitos hay que filtrar por SUSCRIPCION ACTIVA igual que el
      // camino de segmentos: sin esto `destinatarios`/`totalEnviados` contaban gente que
      // no tiene push (el contador mentia) y se creaba un job por cliente sin dispositivo.
      // Ademas se respeta el switch: una promocion es MARKETING aunque se elija a mano.
      const suscritos = await this.prisma.notificacionPush.findMany({
        where: { negocioId, activa: true, clienteId: { in: idsPedidos }, cliente: CLIENTE_ACEPTA },
        select: { clienteId: true },
        distinct: ['clienteId'],
      });
      clienteIds = suscritos.map((s) => s.clienteId);
    } else {
      const suscripciones = await this.prisma.notificacionPush.findMany({
        where: {
          negocioId, activa: true,
          ...(dto.segmento && dto.segmento !== 'TODOS'
            ? { cliente: { ...CLIENTE_ACEPTA, etiqueta: dto.segmento as never } }
            : { cliente: { ...CLIENTE_ACEPTA } }),
        },
        select: { clienteId: true },
        distinct: ['clienteId'],
      });
      clienteIds = suscripciones.map((s) => s.clienteId);
    }

    // La campana se crea PRIMERO: su id viaja en cada job y en cada fila del historial.
    // Ademas es la FUENTE DE VERDAD de CAMPANAS_PUSH_MES (la reconciliacion semanal
    // cuenta filas de CampanaMarketing del periodo: si no se creara aca, el contador
    // se pondria en 0 el domingo). `totalEnviados`/`totalFallidos` los completa el
    // procesador (entregados/fallidos reales); arrancan en 0 para no contar dos veces.
    const campana = await this.prisma.campanaMarketing.create({
      data: {
        negocioId, titulo: dto.titulo, mensaje: dto.cuerpo,
        url: url ?? null, segmento: dto.segmento ?? 'TODOS',
        canal: 'PUSH', esAutomatizacion: false,
        enviadaEn: new Date(), totalEnviados: 0,
      },
    });

    const jobs = await Promise.all(
      clienteIds.map((id) =>
        this.cola.add(
          'enviar',
          {
            negocioId, destino: 'cliente', id, titulo: dto.titulo, cuerpo: dto.cuerpo, url,
            tag: `campana-${campana.id}`,
            campanaId: campana.id,
          },
          {
            attempts: 3,
            backoff: { type: 'custom' }, // 5s, 30s, 5min (ver PushProcessor.backoffStrategy)
            removeOnComplete: 500,
            removeOnFail: 1000,
          },
        ),
      ),
    );

    // Historial: una fila por destinatario (el procesador la completa con el endpoint).
    await this.registrarEnviosEncolados(
      negocioId,
      jobs.map((job, i) => ({
        clienteId: clienteIds[i],
        campanaId: campana.id,
        campanaTitulo: dto.titulo,
        segmento: dto.segmento ?? 'TODOS',
        jobId: job.id,
      })),
    );

    await this.auditoria.registrar({
      negocioId, accion: 'push.promocion_encolada', empleadoId,
      detalle: { titulo: dto.titulo, segmento: dto.segmento ?? 'TODOS', destinatarios: jobs.length },
    });

    await this.limites.incrementarUso(negocioId, 'CAMPANAS_PUSH_MES');

    return { encolados: jobs.length, destinatarios: clienteIds.length, campanaId: campana.id };
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
          { negocioId, destino: 'empleado', id: s.empleadoId, titulo: payload.title, cuerpo: payload.body, url, ...(payload.tag ? { tag: payload.tag } : {}) },
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
      { negocioId, destino: 'empleado', id: empleadoId, titulo: payload.title, cuerpo: payload.body, url, ...(payload.tag ? { tag: payload.tag } : {}) },
      { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
    );
    return { encolados: 1, jobId: job.id };
  }

  /**
   * Envia a un cliente concreto (novedades de su pedido o un disparo).
   *
   * Con `origen.disparoId` el envio deja su fila en `EnvioPushLog` (cuelga del
   * disparo); sin el, es un aviso transaccional (pedido entregado) y NO se
   * registra en el historial de envios a proposito.
   */
  async enviarACliente(
    clienteId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
    origen?: { disparoId?: string; disparoNombre?: string },
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
        ...(payload.tag ? { tag: payload.tag } : {}),
      },
      { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
    );

    if (origen?.disparoId) {
      await this.registrarEnviosEncolados(suscripciones.negocioId, [
        {
          clienteId,
          disparoId: origen.disparoId,
          disparoNombre: origen.disparoNombre ?? null,
          jobId: job.id,
        },
      ]);
    }

    return { encolados: 1, jobId: job.id };
  }

  /** Encola un aviso puntual (lo usa el flujo de visitas). */
  async encolarAvisoStaff(
    negocioId: string,
    empleadoId: string,
    titulo: string,
    cuerpo: string,
    tag?: string,
  ) {
    if (!this.habilitado) return { encolados: 0, motivo: 'VAPID no configurado' };
    const activas = await this.prisma.notificacionPushEmpleado.count({
      where: { negocioId, empleadoId, activa: true },
    });
    if (!activas) return { encolados: 0, motivo: 'sin suscripciones' };

    const job = await this.cola.add(
      'enviar',
      { negocioId, destino: 'empleado', id: empleadoId, titulo, cuerpo, ...(tag ? { tag } : {}) },
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
  // HISTORIAL DE ENVIOS (EnvioPushLog)
  // ==========================================================================

  /**
   * Escribe las filas ENCOLADO de un envio: una por DESTINATARIO. Se llama en el
   * encolado, que todavia no conoce los endpoints (los completa el procesador).
   * `createMany` = un solo INSERT por campana, no una escritura por destinatario.
   */
  private async registrarEnviosEncolados(negocioId: string, filas: EnvioEncolado[]) {
    if (!filas.length) return 0;
    const r = await this.prisma.envioPushLog.createMany({
      data: filas.map((f) => ({
        negocioId,
        estado: 'ENCOLADO' as EstadoEnvioPush,
        campanaId: f.campanaId ?? null,
        campanaTitulo: f.campanaTitulo ?? null,
        disparoId: f.disparoId ?? null,
        disparoNombre: f.disparoNombre ?? null,
        clienteId: f.clienteId ?? null,
        empleadoId: f.empleadoId ?? null,
        segmento: f.segmento ?? null,
        jobId: f.jobId === undefined || f.jobId === null ? null : String(f.jobId),
      })),
    });
    return r.count;
  }

  /**
   * Endpoints de un job que YA recibieron el push. Un reintento de BullMQ volveria a
   * mandarlo a todos: esto evita la notificacion duplicada (y el contador doble).
   */
  async endpointsYaEnviados(jobId: string): Promise<Set<string>> {
    const filas = await this.prisma.envioPushLog.findMany({
      where: { jobId, estado: 'ENVIADO', endpointId: { not: null } },
      select: { endpointId: true },
    });
    return new Set(filas.map((f) => f.endpointId as string));
  }

  /**
   * `ultimoUso` = ultima vez que el dispositivo RECIBIO un push. Sin esto solo se
   * actualizaba al suscribirse y el barrido de 90 dias (`push.scheduler`) daba de
   * baja dispositivos que reciben pushes todas las semanas.
   *
   * Se llama UNA vez por job con los ids que salieron bien: un `updateMany` por
   * destinatario (no una escritura por endpoint).
   */
  async marcarUsoSuscripciones(destino: 'cliente' | 'empleado', ids: string[]) {
    if (!ids.length) return 0;
    const data = { ultimoUso: new Date() };
    const r =
      destino === 'cliente'
        ? await this.prisma.notificacionPush.updateMany({ where: { id: { in: ids } }, data })
        : await this.prisma.notificacionPushEmpleado.updateMany({ where: { id: { in: ids } }, data });
    return r.count;
  }

  /**
   * Completa el historial de UN envio: una fila por (envio x destinatario x endpoint).
   *
   * El encolado dejo UNA semilla ENCOLADO (sin endpoint). Aca, que ya se conocen los
   * endpoints y el manejo de 404/410, la semilla se reusa para el primer endpoint y
   * se crean filas para los demas (un cliente puede tener varios dispositivos).
   * Idempotente ante reintentos: la fila de ese endpoint se ACTUALIZA, no se duplica.
   *
   * Devuelve los deltas de los contadores de la campana: solo cuentan las
   * transiciones reales, asi un reintento no infla `totalEnviados`/`totalFallidos`.
   */
  async completarEnviosDelJob(opts: {
    jobId: string;
    intentos: number;
    resultados: ResultadoEndpoint[];
    /** El job termino sin ningun dispositivo suscrito: se marca SIN_SUSCRIPCION. */
    sinDestinatarios?: boolean;
  }): Promise<DeltaCampana> {
    const delta: DeltaCampana = { enviados: 0, fallidos: 0 };
    const semillas = await this.prisma.envioPushLog.findMany({
      where: { jobId: opts.jobId },
      orderBy: { creadoEn: 'asc' },
    });
    // Envio anterior a este cambio: no hay fila que completar.
    if (!semillas.length) return delta;

    if (!opts.resultados.length) {
      await this.prisma.envioPushLog.updateMany({
        where: { jobId: opts.jobId },
        data: opts.sinDestinatarios
          ? { estado: 'SIN_SUSCRIPCION', motivo: 'sin suscripcion', intentos: opts.intentos }
          : { intentos: opts.intentos },
      });
      return delta;
    }

    const porEndpoint = new Map<string, (typeof semillas)[number]>();
    const libres: (typeof semillas)[number][] = [];
    for (const s of semillas) {
      if (s.endpointId) porEndpoint.set(s.endpointId, s);
      else libres.push(s);
    }
    const plantilla = semillas[0];
    const nuevas: Prisma.EnvioPushLogCreateManyInput[] = [];

    for (const r of opts.resultados) {
      const existente = porEndpoint.get(r.endpointId) ?? libres.shift();
      if (existente) {
        await this.prisma.envioPushLog.update({
          where: { id: existente.id },
          data: {
            ...this.datosDeResultado(r, opts.intentos),
            ...(existente.endpointId ? {} : { endpointId: r.endpointId, endpoint: r.endpoint }),
          },
        });
        this.sumarDelta(delta, existente.estado, r.estado);
        continue;
      }
      nuevas.push({
        negocioId: plantilla.negocioId,
        campanaId: plantilla.campanaId,
        campanaTitulo: plantilla.campanaTitulo,
        disparoId: plantilla.disparoId,
        disparoNombre: plantilla.disparoNombre,
        clienteId: plantilla.clienteId,
        empleadoId: plantilla.empleadoId,
        segmento: plantilla.segmento,
        jobId: opts.jobId,
        endpointId: r.endpointId,
        endpoint: r.endpoint,
        ...this.datosDeResultado(r, opts.intentos),
      });
      this.sumarDelta(delta, null, r.estado);
    }

    if (nuevas.length) await this.prisma.envioPushLog.createMany({ data: nuevas });

    // Defensivo: una semilla que quedo sin endpoint (no deberia pasar: el encolado
    // escribe UNA fila por destinatario).
    if (libres.length) {
      await this.prisma.envioPushLog.updateMany({
        where: { id: { in: libres.map((s) => s.id) } },
        data: { estado: 'SIN_SUSCRIPCION', motivo: 'sin endpoint', intentos: opts.intentos },
      });
    }

    return delta;
  }

  /** Campos de la fila que salen del resultado real del endpoint. */
  private datosDeResultado(r: ResultadoEndpoint, intentos: number) {
    return {
      estado: r.estado as EstadoEnvioPush,
      statusCode: r.statusCode ?? null,
      motivo: r.motivo ?? null,
      error: r.error ?? null,
      intentos,
      enviadoEn: r.estado === 'ENVIADO' ? new Date() : null,
    };
  }

  /** Cuenta solo la TRANSICION real de estado (un reintento que vuelve a fallar no suma). */
  private sumarDelta(delta: DeltaCampana, previo: string | null, nuevo: ResultadoEndpoint['estado']) {
    if (nuevo === 'ENVIADO') {
      if (previo !== 'ENVIADO') delta.enviados++;
      if (previo === 'FALLIDO') delta.fallidos--;
    } else if (nuevo === 'FALLIDO' && previo !== 'FALLIDO') {
      delta.fallidos++;
    }
  }

  /** Aplica los deltas a los contadores de la campana (una sola escritura por job). */
  async aplicarDeltaCampana(campanaId: string | undefined, delta: DeltaCampana) {
    if (!campanaId || (!delta.enviados && !delta.fallidos)) return;
    await this.prisma.campanaMarketing
      .update({
        where: { id: campanaId },
        data: {
          ...(delta.enviados ? { totalEnviados: { increment: delta.enviados } } : {}),
          ...(delta.fallidos ? { totalFallidos: { increment: delta.fallidos } } : {}),
        },
      })
      .catch(() => undefined);
  }

  /**
   * GET /push/envios/logs -> historial de ENVIOS (pestana "Historial" del admin).
   *
   * Una fila por (envio x destinatario x endpoint) con el estado REAL de entrega,
   * mas el resumen por campana ("a cuantos les llego"). El resumen se calcula
   * SIEMPRE desde `EnvioPushLog`, no desde los contadores de la campana.
   */
  async historialEnvios(negocioId: string, filtros: HistorialEnviosDto) {
    const { page, pageSize, skip, take } = getPagination(filtros);

    const where: Prisma.EnvioPushLogWhereInput = { negocioId };
    if (filtros.campanaId) where.campanaId = filtros.campanaId;
    if (filtros.disparoId) where.disparoId = filtros.disparoId;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.clienteId) where.clienteId = filtros.clienteId;
    if (filtros.desde || filtros.hasta) {
      where.creadoEn = {
        ...(filtros.desde ? { gte: new Date(filtros.desde) } : {}),
        ...(filtros.hasta ? { lte: new Date(filtros.hasta) } : {}),
      };
    }

    const [filas, total, campanas] = await Promise.all([
      this.prisma.envioPushLog.findMany({ where, orderBy: { creadoEn: 'desc' }, skip, take }),
      this.prisma.envioPushLog.count({ where }),
      this.resumenCampanas(negocioId, filtros),
    ]);

    // Los nombres se resuelven en UNA query por los ids de la pagina (sin N+1).
    const clienteIds = [
      ...new Set(filas.map((f) => f.clienteId).filter((id): id is string => typeof id === 'string')),
    ];
    const clientes = clienteIds.length
      ? await this.prisma.cliente.findMany({
          where: { id: { in: clienteIds }, negocioId },
          select: { id: true, nombre: true },
        })
      : [];
    const nombrePorCliente = new Map(clientes.map((c) => [c.id, c.nombre]));

    return {
      ...paginar(
        filas.map((f) => ({
          id: f.id,
          estado: f.estado,
          motivo: f.motivo,
          statusCode: f.statusCode,
          intentos: f.intentos,
          creadoEn: f.creadoEn,
          enviadoEn: f.enviadoEn,
          campanaId: f.campanaId,
          campanaTitulo: f.campanaTitulo,
          disparoId: f.disparoId,
          disparoNombre: f.disparoNombre,
          segmento: f.segmento,
          clienteId: f.clienteId,
          clienteNombre: f.clienteId ? (nombrePorCliente.get(f.clienteId) ?? null) : null,
          empleadoId: f.empleadoId,
          // El endpoint es una URL de capacidad del dispositivo: se corta (igual que la auditoria).
          endpoint: f.endpoint ? f.endpoint.slice(0, 60) : null,
        })),
        total,
        page,
        pageSize,
      ),
      campanas,
    };
  }

  /**
   * Resumen por campana: cuantos envios llegaron, cuantos fallaron y cuantos quedaron
   * sin dispositivo. Cuenta SIEMPRE desde `EnvioPushLog` (fuente de verdad).
   */
  private async resumenCampanas(negocioId: string, filtros: HistorialEnviosDto) {
    const seleccion = {
      id: true, titulo: true, segmento: true, enviadaEn: true, creadaEn: true,
    } satisfies Prisma.CampanaMarketingSelect;

    const campanasBase = filtros.campanaId
      ? await this.prisma.campanaMarketing.findMany({
          where: { id: filtros.campanaId, negocioId },
          select: seleccion,
        })
      : await this.prisma.campanaMarketing.findMany({
          where: { negocioId, envios: { some: {} } },
          orderBy: [{ enviadaEn: 'desc' }, { creadaEn: 'desc' }],
          take: CAMPANAS_EN_RESUMEN,
          select: seleccion,
        });
    if (!campanasBase.length) return [];

    const grupos = await this.prisma.envioPushLog.groupBy({
      by: ['campanaId', 'estado'],
      where: { negocioId, campanaId: { in: campanasBase.map((c) => c.id) } },
      _count: { _all: true },
    });

    const conteosPorCampana = new Map<string, Record<string, number>>();
    for (const g of grupos) {
      if (!g.campanaId) continue;
      const acc = conteosPorCampana.get(g.campanaId) ?? {};
      acc[g.estado] = g._count._all;
      conteosPorCampana.set(g.campanaId, acc);
    }

    return campanasBase.map((c) => {
      const conteos = conteosPorCampana.get(c.id) ?? {};
      return {
        campanaId: c.id,
        titulo: c.titulo,
        segmento: c.segmento,
        enviadaEn: c.enviadaEn ?? c.creadaEn,
        total: Object.values(conteos).reduce((a, b) => a + b, 0),
        encolados: conteos.ENCOLADO ?? 0,
        enviados: conteos.ENVIADO ?? 0,
        fallidos: conteos.FALLIDO ?? 0,
        sinSuscripcion: conteos.SIN_SUSCRIPCION ?? 0,
        suprimidos: conteos.SUPRIMIDO_EXCLUIDO ?? 0,
      };
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
  async contextoPlantilla(negocioId: string) {
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
      select: { nombre: true, sellosActuales: true, fechaNacimiento: true },
    });
    const actuales = cliente?.sellosActuales ?? Math.max(1, Math.floor(meta / 2));
    // `{{edad}}` con un valor de ejemplo: la real del primer cliente si tiene el dato, si no 30.
    const edad = edadALaFecha(cliente?.fechaNacimiento ?? null, fechaARDe()) ?? 30;
    return {
      nombre: cliente?.nombre ?? 'Cliente de ejemplo',
      negocio: nombreNegocio,
      premio: premioTexto,
      actuales,
      meta,
      faltantes: Math.max(0, meta - actuales),
      numero: '1042',
      edad,
    } satisfies VariablesPlantilla;
  }

  /**
   * "PROBAR A MI MISMO": manda UNA notificacion al dispositivo de quien la pide
   * (por su `endpoint`), con los textos en edicion y las variables reemplazadas por
   * datos de un cliente real. No requiere que la campaña este guardada y NO toca
   * saldos (mismo espiritu que la prueba de un disparo).
   */
  async probarEnDispositivo(
    negocioId: string,
    payload: { endpoint: string; titulo: string; cuerpo: string; url?: string; icono?: string },
  ) {
    this.exigirVapid();
    const vars = await this.datosEjemplo(negocioId);

    const [cliente, empleado] = await Promise.all([
      this.prisma.notificacionPush.findFirst({
        where: { endpoint: payload.endpoint, activa: true },
        select: { id: true, endpoint: true, auth: true, p256dh: true },
      }),
      this.prisma.notificacionPushEmpleado.findFirst({
        where: { endpoint: payload.endpoint, activa: true },
        select: { id: true, endpoint: true, auth: true, p256dh: true },
      }),
    ]);
    const sub = cliente ?? empleado;
    if (!sub) throw new NotFoundException('Ese dispositivo no tiene una suscripcion activa');

    const urlDestino = await this.urlDePush(
      negocioId,
      payload.url ? this.renderizar(payload.url, vars) : undefined,
      cliente ? 'cliente' : 'staff',
    );

    try {
      await this.enviarAPayload(sub, {
        title: this.renderizar(payload.titulo, vars),
        body: this.renderizar(payload.cuerpo, vars),
        url: urlDestino,
        icon: payload.icono ?? undefined,
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
    return { prueba: true, enviados: 1 };
  }

  /**
   * RESOLUCION DE DESTINATARIOS: fuente UNICA de verdad.
   *
   * La consumen el PREVIEW de una campana (`/push/campanas/preview`) y el ENVIO
   * (`enviarConPlantilla` y el despacho de campanas programables): si divergieran,
   * el numero que ve el dueno no seria el que se manda.
   *
   * La BASE es SIEMPRE `notificacionPush.activa = true` + `cliente.eliminadoEn =
   * null` + `cliente.aceptaNotificaciones = true` (+ el filtro del segmento elegido).
   * El ultimo es el switch del admin: apagado, el cliente queda fuera de TODO el
   * MARKETING (promos, premios y cumpleanos). El push transaccional del pedido NO pasa
   * por aca (ver `enviarACliente`). Las EXCLUSIONES SOLO RECORTAN: una exclusion jamas
   * puede ampliar el publico.
   *
   * Por diseno el numero que devuelve es una ESTIMACION: la base se re-resuelve al
   * momento del envio (puede cambiar entre programar y despachar).
   */
  async resolverPublico(
    negocioId: string,
    filtros: {
      /** Base del publico: 'TODOS' | 'PREMIO_DESBLOQUEADO' | 'INACTIVO_30'. */
      segmento?: string | null;
      /** Clientes excluidos a mano (siempre se respetan). */
      excluirClienteIds?: string[] | null;
      /** Segmentos NEGATIVOS: se recortan de la base. */
      excluirSegmentos?: string[] | null;
    } = {},
  ): Promise<PublicoResuelto> {
    const ctx = await this.contextoPlantilla(negocioId);
    const segmento = (filtros.segmento ?? 'TODOS') as SegmentoEnvio;
    const excluirIds = new Set((filtros.excluirClienteIds ?? []).filter(Boolean));
    const excluirSeg = new Set(filtros.excluirSegmentos ?? []);

    // CUMPLEANOS_MES necesita un set de ids (Prisma no filtra por mes de una fecha): se
    // calcula UNA vez y sirve tanto para la base como para la exclusion.
    const setCumpleMes =
      segmento === 'CUMPLEANOS_MES' || excluirSeg.has('CUMPLEANOS_MES')
        ? new Set(await this.clientesQueCumplenMes(negocioId, fechaARDe().m))
        : null;

    const base: Prisma.NotificacionPushWhereInput = {
      negocioId,
      activa: true,
      cliente: { ...CLIENTE_ACEPTA },
    };
    if (segmento === 'PREMIO_DESBLOQUEADO') {
      base.cliente = { ...CLIENTE_ACEPTA, sellosActuales: { gte: ctx.meta } };
    } else if (segmento === 'INACTIVO_30') {
      const corte = new Date(Date.now() - 30 * 86_400_000);
      base.cliente = {
        ...CLIENTE_ACEPTA,
        OR: [{ ultimaVisita: { lt: corte } }, { ultimaVisita: null }],
      };
    } else if (segmento === 'MUJERES') {
      // `genero: 'FEMENINO'` en el WHERE EXCLUYE solo: quien NO declaro el dato (genero
      // NULL) y quien respondio PREFIERO_NO_DECIR / otra etiqueta no matchean.
      base.cliente = { ...CLIENTE_ACEPTA, genero: 'FEMENINO' };
    } else if (segmento === 'CUMPLEANOS_MES') {
      base.cliente = { ...CLIENTE_ACEPTA, id: { in: [...(setCumpleMes ?? [])] } };
    }

    const subs = await this.prisma.notificacionPush.findMany({
      where: base,
      select: {
        clienteId: true,
        cliente: {
          select: {
            nombre: true,
            sellosActuales: true,
            ultimaVisita: true,
            genero: true,
            fechaNacimiento: true,
          },
        },
      },
    });

    // Dedupe por cliente: un cliente puede tener varios dispositivos suscritos.
    const porCliente = new Map<
      string,
      {
        id: string;
        nombre: string;
        sellosActuales: number;
        ultimaVisita: Date | null;
        genero: GeneroCliente | null;
        fechaNacimiento: Date | null;
      }
    >();
    for (const s of subs) {
      if (porCliente.has(s.clienteId)) continue;
      porCliente.set(s.clienteId, {
        id: s.clienteId,
        nombre: s.cliente.nombre,
        sellosActuales: s.cliente.sellosActuales,
        ultimaVisita: s.cliente.ultimaVisita,
        genero: s.cliente.genero,
        fechaNacimiento: s.cliente.fechaNacimiento,
      });
    }

    const corte30 = Date.now() - 30 * 86_400_000;

    const alcanzables: ClientePublico[] = [];
    const excluidosDetalle: ExcluidoPublico[] = [];
    for (const c of porCliente.values()) {
      let motivo: string | null = null;
      if (excluirIds.has(c.id)) {
        motivo = 'excluido (elegido a mano)';
      } else if (excluirSeg.has('PREMIO_DESBLOQUEADO') && c.sellosActuales >= ctx.meta) {
        motivo = 'excluido (ya tiene el premio)';
      } else if (excluirSeg.has('INACTIVO_30') && (!c.ultimaVisita || c.ultimaVisita.getTime() < corte30)) {
        motivo = 'excluido (inactivo +30 dias)';
      } else if (excluirSeg.has('MUJERES') && c.genero === 'FEMENINO') {
        motivo = 'excluido (mujeres)';
      } else if (excluirSeg.has('CUMPLEANOS_MES') && (setCumpleMes?.has(c.id) ?? false)) {
        motivo = 'excluido (cumpleanios del mes)';
      }
      if (motivo) excluidosDetalle.push({ id: c.id, nombre: c.nombre, motivo });
      else
        alcanzables.push({
          id: c.id,
          nombre: c.nombre,
          sellosActuales: c.sellosActuales,
          fechaNacimiento: c.fechaNacimiento,
        });
    }

    const [clientesNegocio, sinAcepta] = await Promise.all([
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null } }),
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null, aceptaNotificaciones: false } }),
    ]);
    const suscritos = porCliente.size;

    return {
      alcanzables,
      total: suscritos,
      desglose: {
        suscritos,
        excluidos: excluidosDetalle.length,
        // `sinAcepta` queda FUERA: tienen dispositivo, pero el switch apagado los excluye.
        sinSuscripcionActiva: Math.max(0, clientesNegocio - suscritos - sinAcepta),
        sinAcepta,
        clientesNegocio,
      },
      excluidosDetalle,
    };
  }

  /**
   * IDs de los clientes del negocio que cumplen anios ESTE mes (mes de HOY en ARGENTINA).
   *
   * Prisma no puede filtrar por el mes de una fecha, asi que va por RAW. OJO con la zona
   * horaria: `fechaNacimiento` es un DIA DE CALENDARIO guardado a las 00:00 UTC (ver
   * `parseFechaNacimientoPerfil`), asi que `EXTRACT(MONTH FROM ...)` lee el mes correcto SIN
   * conversion. Ajustar con el offset AR (-3h) corromperia los cumpleanos del dia 1: un
   * 01/06 00:00 UTC pasaria a ser 31/05. Por eso NO se toca el timestamp.
   */
  private async clientesQueCumplenMes(negocioId: string, mes: number): Promise<string[]> {
    const filas = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Cliente" WHERE "negocioId" = $1 AND "eliminadoEn" IS NULL ' +
        'AND "fechaNacimiento" IS NOT NULL AND EXTRACT(MONTH FROM "fechaNacimiento") = $2',
      negocioId,
      mes,
    );
    return filas.map((f) => f.id);
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

    const destinatarios = (
      await this.resolverPublico(negocioId, { segmento: dto.segmento })
    ).alcanzables;
    // Campana a clientes: el link sale absoluto y con el slug del tenant.
    const urlCampana = await this.urlDePush(negocioId, url, 'cliente');

    // La campana primero: su id viaja en cada job y en cada fila del historial.
    const campana = await this.prisma.campanaMarketing.create({
      data: {
        negocioId,
        titulo,
        mensaje: cuerpo,
        url: urlCampana ?? null,
        segmento: dto.segmento,
        canal: 'PUSH',
        esAutomatizacion: false,
        enviadaEn: new Date(),
        totalEnviados: 0,
      },
    });

    const jobs = await Promise.all(
      destinatarios.map((c) => {
        const edad = edadALaFecha(c.fechaNacimiento ?? null, fechaARDe());
        const vars: VariablesPlantilla = {
          nombre: c.nombre,
          negocio: ctx.nombreNegocio,
          premio: ctx.premioTexto,
          actuales: c.sellosActuales,
          meta: ctx.meta,
          faltantes: Math.max(0, ctx.meta - c.sellosActuales),
          numero: '',
          ...(edad === null ? {} : { edad }),
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
            tag: `campana-${campana.id}`,
            campanaId: campana.id,
          },
          { attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 500, removeOnFail: 1000 },
        );
      }),
    );

    // Historial: una fila por destinatario (el procesador la completa con el endpoint).
    await this.registrarEnviosEncolados(
      negocioId,
      jobs.map((job, i) => ({
        clienteId: destinatarios[i].id,
        campanaId: campana.id,
        campanaTitulo: titulo,
        segmento: dto.segmento,
        jobId: job.id,
      })),
    );

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

    return { encolados: jobs.length, destinatarios: destinatarios.length, campanaId: campana.id };
  }
}