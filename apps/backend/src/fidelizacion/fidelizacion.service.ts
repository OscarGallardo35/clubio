import { BadRequestException, Injectable } from '@nestjs/common';
import { MetodoVisita, Prisma, TipoVisita } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SegmentosService } from '../clientes/segmentos.service';

export type ModoFidelizacion = 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO';

/** Lo que corresponde otorgar por una acreditacion (una visita o un pedido entregado). */
export interface Acreditacion {
  sellos: number;
  puntos: number;
}

/** Tasa por defecto si el negocio nunca configuro `puntosPorMil`. */
export const PUNTOS_POR_MIL_DEFAULT = 5;
/** Umbral por defecto del premio de puntos (`ConfiguracionClub.premioPorPuntos`). */
export const PUNTOS_PARA_PREMIO_DEFAULT = 100;

/**
 * Puntos que otorga un consumo: `puntosPorMil` puntos por cada $1000.
 *
 * El monto es la UNICA fuente: sin monto (null/undefined/0) no hay puntos. Es la "gracia" que
 * acordamos: si el local no carga el consumo, igual suma el sello (en los modos que dan sello).
 */
export function calcularPuntos(monto: number | null | undefined, puntosPorMil: number): number {
  if (monto === null || monto === undefined) return 0;
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  const tasa = Number.isFinite(puntosPorMil) && puntosPorMil > 0 ? puntosPorMil : 0;
  return Math.floor((monto / 1000) * tasa);
}

/**
 * Sello + puntos segun el modo de fidelizacion. Funcion PURA (sin DB): es la que fija el
 * comportamiento y la que cubre el harness.
 *
 * - SOLO_VISITAS: 1 sello, 0 puntos.
 * - SOLO_PUNTOS: 0 sellos, puntos por monto.
 * - HIBRIDO: 1 sello + puntos por monto.
 */
export function calcularAcreditacion(
  modo: ModoFidelizacion | string | null | undefined,
  monto: number | null | undefined,
  puntosPorMil: number,
): Acreditacion {
  const puntos = calcularPuntos(monto, puntosPorMil);
  if (modo === 'SOLO_PUNTOS') return { sellos: 0, puntos };
  if (modo === 'HIBRIDO') return { sellos: 1, puntos };
  return { sellos: 1, puntos: 0 };
}

/** Contexto de una acreditacion (visita aprobada o pedido entregado). */
export interface CtxAcreditar {
  negocioId: string;
  clienteId: string;
  sucursalId: string;
  /** Null cuando la acredita un proceso automatico (no hay empleado detras). */
  empleadoId: string | null;
  monto: number | null;
  tipo: TipoVisita;
  /** Como entro el consumo: por QR, a mano, o el pedido digital. */
  metodo: MetodoVisita;
  /** Pedido del menu del que sale el monto (Fase 1). Null en el flujo manual/QR. */
  pedidoId?: string | null;
  origen?: string | null;
  notas?: string | null;
}

export interface ResultadoAcreditacion {
  visitaId: string;
  sellos: number;
  puntos: number;
  modoClientes: 'GLOBAL' | 'POR_SUCURSAL';
  modoFidelizacion: ModoFidelizacion;
  sellosActuales: number;
  puntosActuales: number;
  sellosTarjetaSucursal: number;
  puntosTarjetaSucursal: number;
  sellosParaPremio: number;
  premioPorPuntos: number;
  premioDesbloqueado: boolean;
  premioPuntosDesbloqueado: boolean;
}

/**
 * Acreditacion de fidelizacion: la UNICA puerta por la que se otorgan sellos y puntos.
 *
 * Antes esto vivia dentro de `visitas.aprobar` con `const sellosOtorgados = 1` hardcodeado y
 * `puntosOtorgados: 0`. Al extraerlo, la visita aprobada y el pedido entregado otorgan EXACTAMENTE
 * lo mismo (que era el punto del modo HIBRIDO), y hay un solo lugar donde mirar cuando un saldo no
 * cuadra.
 *
 * Recibe una transaccion abierta: el llamador decide que la acreditacion sea atomica con lo suyo
 * (el token que se marca usado, el pedido que pasa a ENTREGADO).
 */
@Injectable()
export class FidelizacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segmentos: SegmentosService,
  ) {}

  /**
   * Config del club + modo de clientes. `ConfiguracionClub` es obligatoria (una por negocio), pero
   * si faltara se usan los defaults en vez de romper el flujo de atencion.
   */
  async contexto(negocioId: string) {
    const [config, negocio] = await Promise.all([
      this.prisma.configuracionClub.findUnique({
        where: { negocioId },
        select: {
          modoFidelizacion: true, puntosPorMil: true, sellosParaPremio: true,
          premioTexto: true, premioPorPuntos: true, premioTextoPuntos: true,
        },
      }),
      this.prisma.negocio.findUnique({ where: { id: negocioId }, select: { modoClientes: true } }),
    ]);

    return {
      modoFidelizacion: (config?.modoFidelizacion ?? 'SOLO_VISITAS') as ModoFidelizacion,
      puntosPorMil: config?.puntosPorMil ?? PUNTOS_POR_MIL_DEFAULT,
      sellosParaPremio: config?.sellosParaPremio ?? 10,
      premioTexto: config?.premioTexto ?? '',
      premioPorPuntos: config?.premioPorPuntos ?? PUNTOS_PARA_PREMIO_DEFAULT,
      premioTextoPuntos: config?.premioTextoPuntos ?? 'Postre gratis',
      porSucursal: negocio?.modoClientes === 'POR_SUCURSAL',
    };
  }

  async acreditar(
    tx: Prisma.TransactionClient,
    ctx: CtxAcreditar,
  ): Promise<ResultadoAcreditacion> {
    const cfg = await this.contexto(ctx.negocioId);
    const { sellos, puntos } = calcularAcreditacion(cfg.modoFidelizacion, ctx.monto, cfg.puntosPorMil);

    const visita = await tx.visita.create({
      data: {
        negocioId: ctx.negocioId,
        sucursalId: ctx.sucursalId,
        clienteId: ctx.clienteId,
        empleadoId: ctx.empleadoId,
        tipo: ctx.tipo,
        sellosOtorgados: sellos,
        puntosOtorgados: puntos,
        montoConsumido: ctx.monto !== null ? new Prisma.Decimal(ctx.monto) : null,
        metodo: ctx.metodo,
        pedidoId: ctx.pedidoId ?? null,
        origen: ctx.origen ?? null,
        notas: ctx.notas ?? null,
      },
      select: { id: true },
    });

    // Cliente: los AGREGADOS (totalVisitas, ultimaVisita, etiqueta) siempre. Los SALDOS solo con
    // modoClientes = GLOBAL: con POR_SUCURSAL el saldo vive en la tarjeta de cada sucursal.
    const cliente = await tx.cliente.findFirstOrThrow({
      where: { id: ctx.clienteId },
      select: { totalVisitas: true, ultimaVisita: true },
    });
    const actualizado = await tx.cliente.update({
      where: { id: ctx.clienteId },
      data: {
        ...(cfg.porSucursal ? {} : { sellosActuales: { increment: sellos }, puntosActuales: { increment: puntos } }),
        totalVisitas: { increment: 1 },
        ultimaVisita: new Date(),
        etiqueta: this.segmentos.calcularEtiqueta(cliente.totalVisitas + 1, new Date()),
      },
      select: { sellosActuales: true, puntosActuales: true },
    });

    // La tarjeta de la sucursal se actualiza SIEMPRE (con GLOBAL es el espejo por sucursal).
    const tarjeta = await tx.tarjetaClienteSucursal.upsert({
      where: { clienteId_sucursalId: { clienteId: ctx.clienteId, sucursalId: ctx.sucursalId } },
      update: {
        sellosActuales: { increment: sellos },
        puntosActuales: { increment: puntos },
        totalVisitas: { increment: 1 },
        ultimaVisita: new Date(),
      },
      create: {
        clienteId: ctx.clienteId,
        sucursalId: ctx.sucursalId,
        sellosActuales: sellos,
        puntosActuales: puntos,
        totalVisitas: 1,
        ultimaVisita: new Date(),
      },
      select: { sellosActuales: true, puntosActuales: true },
    });

    // El saldo con el que se mide cada premio depende del modo de clientes.
    const sellosEfectivos = cfg.porSucursal ? tarjeta.sellosActuales : actualizado.sellosActuales;
    const puntosEfectivos = cfg.porSucursal ? tarjeta.puntosActuales : actualizado.puntosActuales;

    return {
      visitaId: visita.id,
      sellos,
      puntos,
      modoClientes: cfg.porSucursal ? 'POR_SUCURSAL' : 'GLOBAL',
      modoFidelizacion: cfg.modoFidelizacion,
      sellosActuales: sellosEfectivos,
      puntosActuales: puntosEfectivos,
      sellosTarjetaSucursal: tarjeta.sellosActuales,
      puntosTarjetaSucursal: tarjeta.puntosActuales,
      sellosParaPremio: cfg.sellosParaPremio,
      premioPorPuntos: cfg.premioPorPuntos,
      premioDesbloqueado: sellosEfectivos >= cfg.sellosParaPremio,
      premioPuntosDesbloqueado: puntosEfectivos >= cfg.premioPorPuntos,
    };
  }

  /**
   * Fase 2: corrige el monto de una visita ya aprobada y ajusta los PUNTOS por el delta.
   *
   * Decisiones del dueño que estan aca adentro:
   *   - los puntos se recalculan con la TASA VIGENTE del club (no con la del momento de la visita);
   *   - los SELLOS no se tocan: el sello es por visita, no por monto (la unica fuente de sellos es
   *     `calcularAcreditacion`, que solo mira el modo);
   *   - si el delta es negativo y el cliente ya no tiene ese saldo, se RECHAZA (no se clampea a 0:
   *     clampear regalaria la diferencia en silencio).
   *
   * El saldo a tocar sigue la MISMA regla que `acreditar`: con POR_SUCURSAL vive en la tarjeta.
   */
  async recalcularVisitaPorMonto(
    tx: Prisma.TransactionClient,
    ctx: { negocioId: string; visitaId: string; montoNuevo: number },
  ): Promise<{
    montoAntes: number | null; montoDespues: number;
    puntosAntes: number; puntosDespues: number; saldoDespues: number;
  }> {
    const cfg = await this.contexto(ctx.negocioId);
    const visita = await tx.visita.findFirstOrThrow({
      where: { id: ctx.visitaId, negocioId: ctx.negocioId },
      select: {
        id: true, clienteId: true, sucursalId: true,
        puntosOtorgados: true, montoConsumido: true,
      },
    });

    const puntosDespues = calcularPuntos(ctx.montoNuevo, cfg.puntosPorMil);
    const delta = puntosDespues - visita.puntosOtorgados;

    const saldo = cfg.porSucursal
      ? (await tx.tarjetaClienteSucursal.findUnique({
          where: {
            clienteId_sucursalId: { clienteId: visita.clienteId, sucursalId: visita.sucursalId },
          },
          select: { puntosActuales: true },
        }))?.puntosActuales ?? 0
      : (await tx.cliente.findUnique({
          where: { id: visita.clienteId }, select: { puntosActuales: true },
        }))?.puntosActuales ?? 0;

    if (delta < 0 && saldo + delta < 0) {
      throw new BadRequestException(
        `El cliente ya gasto esos puntos: tiene ${saldo} y la correccion le sacaria ${Math.abs(delta)}. No se puede bajar el monto.`,
      );
    }

    await tx.visita.update({
      where: { id: visita.id },
      data: {
        montoConsumido: new Prisma.Decimal(ctx.montoNuevo),
        puntosOtorgados: puntosDespues,
      },
    });

    if (delta !== 0) {
      if (!cfg.porSucursal) {
        await tx.cliente.update({
          where: { id: visita.clienteId },
          data: { puntosActuales: { increment: delta } },
        });
      }
      await tx.tarjetaClienteSucursal.updateMany({
        where: { clienteId: visita.clienteId, sucursalId: visita.sucursalId },
        data: { puntosActuales: { increment: delta } },
      });
    }

    return {
      montoAntes: visita.montoConsumido === null ? null : Number(visita.montoConsumido),
      montoDespues: ctx.montoNuevo,
      puntosAntes: visita.puntosOtorgados,
      puntosDespues,
      saldoDespues: saldo + delta,
    };
  }
}
