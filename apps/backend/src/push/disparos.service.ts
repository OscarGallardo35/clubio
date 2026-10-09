import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DisparoPush, PlantillaPush, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { PushService, VariablesPlantilla } from './push.service';
import type { CrearDisparoDto } from './dto/crear-disparo.dto';
import type { ActualizarDisparoDto } from './dto/actualizar-disparo.dto';

/** Cola de los jobs de tiempo (DIA / INACTIVIDAD). */
export const COLA_DISPAROS = 'push-disparos';

/** Cada cuanto corre el job de DIA (tambien es el ancho de la ventana de `hora`). */
export const DIA_TICK_MIN = 15;

/** Argentina es UTC-3 TODO el año (no hay horario de verano). */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIAS_SEMANA = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

export interface AhoraArgentina {
  /** Dia de la semana en AR: 'MONDAY'..'SUNDAY'. */
  semana: string;
  /** Fecha en AR: 'YYYY-MM-DD'. */
  fecha: string;
  /** Minutos desde las 00:00 en AR. */
  minutos: number;
  /** 00:00 de hoy en AR, expresado en UTC (03:00Z). */
  inicioDia: Date;
  /** 00:00 del 1ro del mes en AR, en UTC. */
  inicioMes: Date;
}

/**
 * "Ahora" en hora argentina, derivado de un `Date` UTC sin depender de la TZ del
 * proceso (en Railway el proceso corre en UTC). Con el offset fijo -3h, los
 * getters UTC del Date desplazado son la hora local de Argentina.
 */
export function ahoraArgentina(base: Date = new Date()): AhoraArgentina {
  const ar = new Date(base.getTime() - AR_OFFSET_MS);
  const y = ar.getUTCFullYear();
  const m = ar.getUTCMonth();
  const d = ar.getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    semana: DIAS_SEMANA[ar.getUTCDay()],
    fecha: `${y}-${p(m + 1)}-${p(d)}`,
    minutos: ar.getUTCHours() * 60 + ar.getUTCMinutes(),
    inicioDia: new Date(Date.UTC(y, m, d, 3, 0, 0)), // 00:00 AR == 03:00 UTC
    inicioMes: new Date(Date.UTC(y, m, 1, 3, 0, 0)),
  };
}

/** 'HH:MM' -> minutos desde 00:00. null si el formato es invalido. */
export function horaAMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

type DisparoConPlantilla = DisparoPush & { plantilla: PlantillaPush };

interface ClienteMin {
  id: string;
  nombre: string;
  sellosActuales: number;
}

interface ContextoClub {
  nombre: string;
  activo: boolean;
  porSucursal: boolean;
  modo: string;
  meta: number;
  premio: string;
}

/**
 * MOTOR de los DisparoPush.
 *
 * Cada disparo tiene un `clave` de dedupe que se materializa en `DisparoPushLog`
 * con UNIQUE(disparoId, clave): ahi esta el candado anti doble ejecucion
 * (mismo patron que el vinculo 1-1 visita<->pedido, pero generico). Ese log es
 * tambien la fuente de los topes por cliente y la auditoria del regalo.
 */
@Injectable()
export class DisparosService {
  private readonly logger = new Logger('Disparos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
  ) {}

  // ==========================================================================
  // CRUD (lo consume el admin)
  // ==========================================================================

  listar(negocioId: string) {
    return this.prisma.disparoPush.findMany({
      where: { negocioId },
      orderBy: [{ activa: 'desc' }, { creadoEn: 'asc' }],
      include: { plantilla: { select: { id: true, nombre: true, titulo: true, activa: true } } },
    });
  }

  async crear(negocioId: string, dto: CrearDisparoDto, empleadoId?: string) {
    await this.exigirPlantilla(negocioId, dto.plantillaId);
    const disparo = await this.prisma.disparoPush.create({
      data: {
        negocioId,
        nombre: dto.nombre,
        tipo: dto.tipo,
        plantillaId: dto.plantillaId,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
        ...(dto.regalo !== undefined ? { regalo: dto.regalo as Prisma.InputJsonValue } : {}),
        ...(dto.limitePorCliente !== undefined
          ? { limitePorCliente: dto.limitePorCliente as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.disparo_creado',
      empleadoId,
      detalle: { disparoId: disparo.id, tipo: disparo.tipo, nombre: disparo.nombre },
    });
    return disparo;
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarDisparoDto, empleadoId?: string) {
    const existente = await this.prisma.disparoPush.findFirst({
      where: { id, negocioId },
      select: { id: true },
    });
    if (!existente) throw new NotFoundException('Disparo no encontrado');
    if (dto.plantillaId) await this.exigirPlantilla(negocioId, dto.plantillaId);

    const disparo = await this.prisma.disparoPush.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
        ...(dto.plantillaId !== undefined ? { plantillaId: dto.plantillaId } : {}),
        ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
        ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonValue } : {}),
        ...(dto.regalo !== undefined
          ? { regalo: dto.regalo === null ? Prisma.JsonNull : (dto.regalo as Prisma.InputJsonValue) }
          : {}),
        ...(dto.limitePorCliente !== undefined
          ? {
              limitePorCliente:
                dto.limitePorCliente === null
                  ? Prisma.JsonNull
                  : (dto.limitePorCliente as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.disparo_actualizado',
      empleadoId,
      detalle: { disparoId: id },
    });
    return disparo;
  }

  async eliminar(negocioId: string, id: string, empleadoId?: string) {
    const existente = await this.prisma.disparoPush.findFirst({
      where: { id, negocioId },
      select: { id: true, nombre: true },
    });
    if (!existente) throw new NotFoundException('Disparo no encontrado');
    await this.prisma.disparoPush.delete({ where: { id } });
    await this.auditoria.registrar({
      negocioId,
      accion: 'push.disparo_eliminado',
      empleadoId,
      detalle: { disparoId: id, nombre: existente.nombre },
    });
    return { ok: true };
  }

  /** POST /push/disparos/:id/probar -> manda el push AHORA a un cliente puntual. */
  async probar(negocioId: string, id: string, clienteId: string, empleadoId?: string) {
    const disparo = await this.prisma.disparoPush.findFirst({
      where: { id, negocioId },
      include: { plantilla: true },
    });
    if (!disparo) throw new NotFoundException('Disparo no encontrado');

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, sellosActuales: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const cfg = await this.contexto(negocioId);
    // La prueba NO toca saldos: solo manda el push.
    const res = await this.enviarPush(disparo, cliente, cfg, { numero: '' });

    await this.auditoria.registrar({
      negocioId,
      accion: 'push.disparo_probado',
      empleadoId,
      clienteId: cliente.id,
      detalle: { disparoId: id, encolados: res.encolados ?? 0 },
    });
    return { prueba: true, disparoId: id, clienteId: cliente.id, ...res };
  }

  // ==========================================================================
  // MOTOR - COMPRA (lo llama PedidosService.cambiarEstado)
  // ==========================================================================

  /**
   * Se dispara con CADA cambio de estado del pedido; el servicio filtra los
   * disparos COMPRA cuyo `config.estado` coincide (default ENTREGADO).
   * NUNCA sobre CANCELADO/RECHAZADO.
   */
  async onPedidoEstado(ctx: {
    negocioId: string;
    pedidoId: string;
    clienteId: string | null;
    sucursalId: string | null;
    estadoNuevo: string;
  }) {
    if (ctx.estadoNuevo === 'CANCELADO' || ctx.estadoNuevo === 'RECHAZADO') {
      return { procesados: 0, motivo: 'estado final negativo' };
    }
    if (!ctx.clienteId) return { procesados: 0, motivo: 'pedido sin cliente' };

    const disparos = (await this.prisma.disparoPush.findMany({
      where: { negocioId: ctx.negocioId, tipo: 'COMPRA', activa: true },
      include: { plantilla: true },
    })) as DisparoConPlantilla[];
    if (!disparos.length) return { procesados: 0 };

    const cfg = await this.contexto(ctx.negocioId);
    if (!cfg.activo) return { procesados: 0, motivo: 'negocio inactivo' };

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: ctx.clienteId, negocioId: ctx.negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, sellosActuales: true },
    });
    if (!cliente) return { procesados: 0, motivo: 'cliente inexistente o dado de baja' };

    const resultados: unknown[] = [];
    for (const d of disparos) {
      const conf = (d.config ?? {}) as { estado?: string; cadaNCompras?: number };
      const estado = conf.estado ?? 'ENTREGADO';
      if (estado !== ctx.estadoNuevo) continue;

      const cadaN = Math.max(1, Math.floor(Number(conf.cadaNCompras ?? 1)));
      if (cadaN > 1) {
        const compras = await this.prisma.pedido.count({
          where: { negocioId: ctx.negocioId, clienteId: cliente.id, estado: 'ENTREGADO' },
        });
        if (compras % cadaN !== 0) {
          resultados.push({ disparoId: d.id, omitido: `cadaNCompras (${compras}%${cadaN})` });
          continue;
        }
      }

      resultados.push(
        await this.ejecutarUno(d, {
          cliente,
          cfg,
          clave: `COMPRA:${ctx.pedidoId}`,
          pedidoId: ctx.pedidoId,
          sucursalId: ctx.sucursalId,
          origen: 'COMPRA',
        }),
      );
    }
    return { procesados: resultados.length, resultados };
  }

  // ==========================================================================
  // MOTOR - SELLOS (lo llaman VisitasService y PedidosService al cambiar saldo)
  // ==========================================================================

  /**
   * Se llama cuando el SALDO del cliente cambia (visita aprobada / pedido
   * entregado acreditado). Evalua CADA_SELLO o FALTAN_N segun config. Sin regalo.
   */
  async onSaldoCambia(ctx: {
    negocioId: string;
    clienteId: string;
    sucursalId: string | null;
    visitaId: string;
    sellosActuales: number;
    sellosParaPremio: number;
  }) {
    const disparos = (await this.prisma.disparoPush.findMany({
      where: { negocioId: ctx.negocioId, tipo: 'SELLOS', activa: true },
      include: { plantilla: true },
    })) as DisparoConPlantilla[];
    if (!disparos.length) return { procesados: 0 };

    const cfg = await this.contexto(ctx.negocioId);
    if (!cfg.activo) return { procesados: 0, motivo: 'negocio inactivo' };

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: ctx.clienteId, negocioId: ctx.negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, sellosActuales: true },
    });
    if (!cliente) return { procesados: 0, motivo: 'cliente inexistente o dado de baja' };

    const faltantes = Math.max(0, ctx.sellosParaPremio - ctx.sellosActuales);
    const resultados: unknown[] = [];
    for (const d of disparos) {
      const conf = (d.config ?? {}) as { cuando?: string; n?: number };
      const cuando = conf.cuando ?? 'CADA_SELLO';
      const n = Math.max(1, Math.floor(Number(conf.n ?? 1)));
      if (cuando === 'FALTAN_N' && faltantes !== n) continue;

      resultados.push(
        await this.ejecutarUno(d, {
          cliente,
          cfg,
          clave: `SELLOS:${ctx.visitaId}`,
          pedidoId: null,
          sucursalId: ctx.sucursalId,
          origen: 'SELLOS',
        }),
      );
    }
    return { procesados: resultados.length, resultados };
  }

  // ==========================================================================
  // MOTOR - BIENVENIDA (lo llaman AuthService y ClientesService al dar de alta)
  // ==========================================================================

  async onClienteNuevo(ctx: { negocioId: string; clienteId: string; sucursalId?: string | null }) {
    const disparos = (await this.prisma.disparoPush.findMany({
      where: { negocioId: ctx.negocioId, tipo: 'BIENVENIDA', activa: true },
      include: { plantilla: true },
    })) as DisparoConPlantilla[];
    if (!disparos.length) return { procesados: 0 };

    const cfg = await this.contexto(ctx.negocioId);
    if (!cfg.activo) return { procesados: 0, motivo: 'negocio inactivo' };

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: ctx.clienteId, negocioId: ctx.negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, sellosActuales: true },
    });
    if (!cliente) return { procesados: 0 };

    const resultados: unknown[] = [];
    for (const d of disparos) {
      resultados.push(
        await this.ejecutarUno(d, {
          cliente,
          cfg,
          clave: `BIENVENIDA:${cliente.id}`, // una sola vez en la vida del cliente
          pedidoId: null,
          sucursalId: ctx.sucursalId ?? null,
          origen: 'BIENVENIDA',
        }),
      );
    }
    return { procesados: resultados.length, resultados };
  }

  // ==========================================================================
  // MOTOR - DIA (job repeatable de BullMQ, cada DIA_TICK_MIN minutos)
  // ==========================================================================

  async evaluarDia(base: Date = new Date()) {
    const ahora = ahoraArgentina(base);
    const disparos = (await this.prisma.disparoPush.findMany({
      where: { tipo: 'DIA', activa: true },
      include: { plantilla: true, negocio: { select: { activo: true } } },
    })) as (DisparoConPlantilla & { negocio: { activo: boolean } })[];

    let evaluados = 0;
    let enviados = 0;
    for (const d of disparos) {
      if (!d.negocio.activo) continue;
      const conf = (d.config ?? {}) as { dia?: string; hora?: string };
      const dia = String(conf.dia ?? '').trim().toUpperCase();
      const horaMin = horaAMinutos(String(conf.hora ?? ''));
      if (!dia || horaMin === null) {
        this.logger.warn(`Disparo DIA ${d.id} con config invalida (dia='${dia}', hora='${String(conf.hora ?? '')}')`);
        continue;
      }
      // Ventana [hora, hora + tick): asi un `hora:'18:00'` manda entre 18:00 y 18:15.
      if (ahora.minutos < horaMin || ahora.minutos >= horaMin + DIA_TICK_MIN) continue;

      const esFecha = /^\d{4}-\d{2}-\d{2}$/.test(dia);
      if (esFecha ? dia !== ahora.fecha : dia !== ahora.semana) continue;

      evaluados++;
      const cfg = await this.contexto(d.negocioId);
      const clientes = await this.destinatarios(d.negocioId);
      for (const c of clientes) {
        const r = await this.ejecutarUno(d, {
          cliente: c,
          cfg,
          clave: `DIA:${ahora.fecha}`,
          pedidoId: null,
          sucursalId: null, // se resuelve por cliente dentro de ejecutarUno
          origen: 'DIA',
        });
        if ((r as { enviado?: boolean }).enviado) enviados++;
      }
    }
    return { tick: { fecha: ahora.fecha, semana: ahora.semana, minutos: ahora.minutos }, disparos: evaluados, enviados };
  }

  // ==========================================================================
  // MOTOR - INACTIVIDAD (job diario de BullMQ)
  // ==========================================================================

  async evaluarInactividad(base: Date = new Date()) {
    const ahora = ahoraArgentina(base);
    const disparos = (await this.prisma.disparoPush.findMany({
      where: { tipo: 'INACTIVIDAD', activa: true },
      include: { plantilla: true, negocio: { select: { activo: true } } },
    })) as (DisparoConPlantilla & { negocio: { activo: boolean } })[];

    let enviados = 0;
    for (const d of disparos) {
      if (!d.negocio.activo) continue;
      const conf = (d.config ?? {}) as { dias?: number };
      const dias = Math.max(1, Math.floor(Number(conf.dias ?? 30)));
      const corte = new Date(base.getTime() - dias * 86_400_000);
      const cfg = await this.contexto(d.negocioId);
      const clientes = await this.destinatarios(d.negocioId, corte);
      for (const c of clientes) {
        const r = await this.ejecutarUno(d, {
          cliente: c,
          cfg,
          clave: `INACTIVIDAD:${ahora.fecha}`,
          pedidoId: null,
          sucursalId: null,
          origen: 'INACTIVIDAD',
        });
        if ((r as { enviado?: boolean }).enviado) enviados++;
      }
    }
    return { tick: { fecha: ahora.fecha }, enviados };
  }

  // ==========================================================================
  // INTERNOS
  // ==========================================================================

  /**
   * Ejecucion canonica de UN disparo para UN cliente: tope -> candado -> regalo
   * -> push. Devuelve si envio (o el motivo por el que se omitio).
   */
  private async ejecutarUno(
    d: DisparoConPlantilla,
    opts: {
      cliente: ClienteMin;
      cfg: ContextoClub;
      clave: string;
      pedidoId: string | null;
      sucursalId: string | null;
      origen: string;
    },
  ) {
    const { cliente, cfg, clave } = opts;

    // 1) Topes por cliente (se respetan ANTES de acreditar o enviar).
    const excedido = await this.excedeLimite(d, cliente.id);
    if (excedido) {
      await this.logOmitido(d, cliente.id, opts.pedidoId, clave, 'OMITIDO_LIMITE', excedido);
      return { disparoId: d.id, omitido: 'limite', detalle: excedido };
    }

    // 2) Candado idempotente: si la clave ya existe para este disparo, no se repite.
    const regaloCalc = this.calcularRegalo(d.regalo, cfg.modo);
    const lock = await this.tomarLock(d, {
      clienteId: cliente.id,
      pedidoId: opts.pedidoId,
      clave,
      sellos: regaloCalc.sellos,
      puntos: regaloCalc.puntos,
    });
    if (!lock) return { disparoId: d.id, omitido: 'duplicado' };

    // 3) Regalo (si tiene): acredita sellos/puntos respetando el modo del club.
    let aplicado = { sellos: 0, puntos: 0 };
    if (regaloCalc.sellos || regaloCalc.puntos) {
      const sucursalId = await this.sucursalDe(d.negocioId, cliente.id, opts.sucursalId);
      aplicado = await this.aplicarRegalo(cliente.id, sucursalId, d.regalo, cfg);
      await this.auditoria.registrar({
        negocioId: d.negocioId,
        accion: 'push.disparo_regalo',
        clienteId: cliente.id,
        detalle: {
          disparoId: d.id,
          tipo: d.tipo,
          origen: opts.origen,
          pedidoId: opts.pedidoId,
          sellos: aplicado.sellos,
          puntos: aplicado.puntos,
          sucursalId,
        },
      });
    }

    // 4) Push (encolado, best-effort).
    const pushRes = await this.enviarPush(d, cliente, cfg, {});

    await this.prisma.disparoPushLog
      .update({
        where: { id: lock.id },
        data: { detalle: { push: pushRes, regalo: aplicado, origen: opts.origen } as Prisma.InputJsonValue },
      })
      .catch(() => undefined);

    return { disparoId: d.id, enviado: true, sellos: aplicado.sellos, puntos: aplicado.puntos, push: pushRes };
  }

  /**
   * Regalo respetando el modo del club: SOLO_PUNTOS ignora sellos; SOLO_VISITAS
   * ignora puntos; HIBRIDO da ambos. El saldo se toca con la MISMA regla que
   * `FidelizacionService.acreditar`: con POR_SUCURSAL vive en la tarjeta de la
   * sucursal (y NO en el contador del cliente); con GLOBAL, en el cliente.
   */
  private async aplicarRegalo(
    clienteId: string,
    sucursalId: string,
    regalo: unknown,
    cfg: ContextoClub,
  ) {
    const { sellos, puntos } = this.calcularRegalo(regalo, cfg.modo);
    if (!sellos && !puntos) return { sellos: 0, puntos: 0 };

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.tarjetaClienteSucursal.upsert({
        where: { clienteId_sucursalId: { clienteId, sucursalId } },
        update: { sellosActuales: { increment: sellos }, puntosActuales: { increment: puntos } },
        create: { clienteId, sucursalId, sellosActuales: sellos, puntosActuales: puntos },
      }),
    ];
    if (!cfg.porSucursal) {
      ops.push(
        this.prisma.cliente.update({
          where: { id: clienteId },
          data: { sellosActuales: { increment: sellos }, puntosActuales: { increment: puntos } },
        }),
      );
    }
    await this.prisma.$transaction(ops);
    return { sellos, puntos };
  }

  private calcularRegalo(regalo: unknown, modo: string): { sellos: number; puntos: number } {
    const r = (regalo ?? {}) as { sellos?: unknown; puntos?: unknown };
    const s = Math.max(0, Math.floor(Number(r.sellos ?? 0))) || 0;
    const p = Math.max(0, Math.floor(Number(r.puntos ?? 0))) || 0;
    return {
      sellos: modo === 'SOLO_PUNTOS' ? 0 : s,
      puntos: modo === 'SOLO_VISITAS' ? 0 : p,
    };
  }

  /** Cuenta ejecuciones ENVIADO del disparo para el cliente en la ventana; null si no excede. */
  private async excedeLimite(d: DisparoPush, clienteId: string) {
    const lim = (d.limitePorCliente ?? {}) as { porDia?: unknown; porMes?: unknown };
    const porDia = Math.max(0, Math.floor(Number(lim.porDia ?? 0))) || 0;
    const porMes = Math.max(0, Math.floor(Number(lim.porMes ?? 0))) || 0;
    if (!porDia && !porMes) return null;

    const ahora = ahoraArgentina();
    const ventanas: Array<{ tipo: string; desde: Date; max: number }> = [];
    if (porDia > 0) ventanas.push({ tipo: 'porDia', desde: ahora.inicioDia, max: porDia });
    if (porMes > 0) ventanas.push({ tipo: 'porMes', desde: ahora.inicioMes, max: porMes });

    for (const v of ventanas) {
      const usado = await this.prisma.disparoPushLog.count({
        where: {
          disparoId: d.id,
          clienteId,
          accion: 'ENVIADO',
          creadoEn: { gte: v.desde },
        },
      });
      if (usado >= v.max) return { tipo: v.tipo, usado, max: v.max, desde: v.desde.toISOString() };
    }
    return null;
  }

  /** Crea la fila-candado. Devuelve null si la clave ya existia (P2002) = duplicado. */
  private async tomarLock(
    d: DisparoPush,
    data: { clienteId: string; pedidoId: string | null; clave: string; sellos: number; puntos: number },
  ) {
    try {
      return await this.prisma.disparoPushLog.create({
        data: {
          disparoId: d.id,
          negocioId: d.negocioId,
          clienteId: data.clienteId,
          pedidoId: data.pedidoId,
          tipo: d.tipo,
          clave: data.clave,
          accion: 'ENVIADO',
          sellosAcreditados: data.sellos,
          puntosAcreditados: data.puntos,
        },
      });
    } catch (e) {
      if (this.esUnique(e)) return null;
      throw e;
    }
  }

  private async logOmitido(
    d: DisparoPush,
    clienteId: string,
    pedidoId: string | null,
    clave: string,
    accion: string,
    detalle: unknown,
  ) {
    try {
      await this.prisma.disparoPushLog.create({
        data: {
          disparoId: d.id,
          negocioId: d.negocioId,
          clienteId,
          pedidoId,
          tipo: d.tipo,
          clave,
          accion,
          detalle: detalle as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (!this.esUnique(e)) throw e;
    }
  }

  private esUnique(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  private async enviarPush(
    d: DisparoConPlantilla,
    cliente: ClienteMin,
    cfg: ContextoClub,
    extra: Partial<VariablesPlantilla>,
  ) {
    const vars = this.varsDe(cfg, cliente, extra);
    const p = d.plantilla;
    const res = await this.push.enviarACliente(cliente.id, {
      title: this.push.renderizar(p.titulo, vars),
      body: this.push.renderizar(p.cuerpo, vars),
      ...(p.url ? { url: this.push.renderizar(p.url, vars) } : {}),
      tag: `disparo-${d.id}`,
    });
    return res;
  }

  private varsDe(
    cfg: ContextoClub,
    cliente: ClienteMin,
    extra: Partial<VariablesPlantilla>,
  ): VariablesPlantilla {
    return {
      nombre: cliente.nombre,
      negocio: cfg.nombre,
      premio: cfg.premio,
      actuales: cliente.sellosActuales,
      meta: cfg.meta,
      faltantes: Math.max(0, cfg.meta - cliente.sellosActuales),
      ...extra,
    };
  }

  /** Negocio activo + modos + meta/premio del club. */
  private async contexto(negocioId: string): Promise<ContextoClub> {
    const [neg, cfg] = await Promise.all([
      this.prisma.negocio.findUnique({
        where: { id: negocioId },
        select: { nombre: true, activo: true, modoClientes: true },
      }),
      this.prisma.configuracionClub.findUnique({
        where: { negocioId },
        select: { modoFidelizacion: true, sellosParaPremio: true, premioTexto: true },
      }),
    ]);
    return {
      nombre: neg?.nombre ?? 'el local',
      activo: neg?.activo ?? false,
      porSucursal: neg?.modoClientes === 'POR_SUCURSAL',
      modo: (cfg?.modoFidelizacion ?? 'SOLO_VISITAS') as string,
      meta: cfg?.sellosParaPremio ?? 10,
      premio: cfg?.premioTexto ?? 'tu premio',
    };
  }

  /**
   * Clientes destinatarios: con suscripcion push activa, no dados de baja, del
   * negocio. `corte` (opcional) limita a los inactivos (sin visita desde `corte`,
   * incluidos los que nunca vinieron) — mismo criterio que el segmento INACTIVO_30.
   */
  private async destinatarios(negocioId: string, corte?: Date) {
    const subs = await this.prisma.notificacionPush.findMany({
      where: {
        negocioId,
        activa: true,
        cliente: {
          eliminadoEn: null,
          ...(corte ? { OR: [{ ultimaVisita: { lt: corte } }, { ultimaVisita: null }] } : {}),
        },
      },
      select: { clienteId: true, cliente: { select: { id: true, nombre: true, sellosActuales: true } } },
    });
    const mapa = new Map<string, ClienteMin>();
    for (const s of subs) {
      if (mapa.has(s.clienteId)) continue;
      mapa.set(s.clienteId, {
        id: s.cliente.id,
        nombre: s.cliente.nombre,
        sellosActuales: s.cliente.sellosActuales,
      });
    }
    return [...mapa.values()];
  }

  /** Sucursal para acreditar: la del evento si vino; si no, la que resuelve el cliente. */
  private async sucursalDe(negocioId: string, clienteId: string, preferida: string | null) {
    if (preferida) return preferida;
    const s = await this.resolver.resolverSucursal(negocioId, { clienteId });
    return s.id as string;
  }

  private async exigirPlantilla(negocioId: string, plantillaId: string) {
    const p = await this.prisma.plantillaPush.findFirst({
      where: { id: plantillaId, negocioId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
  }
}
