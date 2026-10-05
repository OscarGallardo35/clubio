import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EstadoUso, RecursoLimitado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService, RECURSO_A_FEATURE, esMensual, periodoActual } from './plan.service';
import { UsoMensualService } from './uso-mensual.service';
import type { LimiteResult, VerificarLimiteOpts } from './interfaces/limite-result.interface';

const ETIQUETA: Record<string, string> = {
  clientes: 'clientes', empleados: 'empleados', sucursales: 'sucursales',
  items_carta: 'items de carta', pedidos_mes: 'pedidos del mes',
  campanas_push_mes: 'campanas push del mes',
};

@Injectable()
export class LimitesService {
  private readonly logger = new Logger('Limites');

  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
    private readonly uso: UsoMensualService,
  ) {}

  /**
   * Verifica si se puede usar 1 (o `incremento`) mas del recurso.
   *
   * NO incrementa: solo consulta. El llamador incrementa DESPUES de escribir,
   * para que una creacion fallida no infle el contador.
   */
  async verificarLimite(
    negocioId: string, recurso: RecursoLimitado, opts: VerificarLimiteOpts = {},
  ): Promise<LimiteResult> {
    const incremento = opts.incremento ?? 1;
    const periodo = opts.periodo ?? periodoActual();
    const sucursalId = opts.sucursalId ?? null;

    const plan = await this.plan.planDeNegocio(negocioId);
    const limite = await this.plan.obtenerLimite(plan, recurso);
    const ilimitado = limite === null;
    const colchon = await this.uso.colchonDe(negocioId);
    const limiteBase = limite ?? 0;
    const limiteGracia = limiteBase + colchon;

    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { payPerUseActivo: true },
    });
    const payPerUse = neg?.payPerUseActivo ?? false;

    const uso = await this.uso.obtenerOCrearUso(negocioId, recurso, periodo, sucursalId);
    const cantidadProyectada = uso.cantidad + incremento;

    const etiqueta = ETIQUETA[RECURSO_A_FEATURE[recurso]] ?? RECURSO_A_FEATURE[recurso];

    if (ilimitado) {
      return {
        recurso, permitido: true, estado: 'NORMAL', cantidad: uso.cantidad,
        limiteBase: 0, limiteGracia: 0, usosRestantes: Number.MAX_SAFE_INTEGER,
        excedente: 0, payPerUse, ilimitado: true,
        motivo: `${etiqueta}: ilimitado en el plan ${plan}`,
      };
    }

    let estado: EstadoUso = 'NORMAL';
    if (cantidadProyectada > limiteGracia) estado = 'EXCEDIDO';
    else if (cantidadProyectada > limiteBase) estado = 'ADVERTENCIA';

    const excedente = Math.max(0, cantidadProyectada - limiteGracia);
    const bloquea = estado === 'EXCEDIDO' && !payPerUse;

    return {
      recurso,
      permitido: !bloquea,
      estado,
      cantidad: uso.cantidad,
      limiteBase,
      limiteGracia,
      usosRestantes: Math.max(0, limiteGracia - uso.cantidad),
      excedente,
      payPerUse,
      ilimitado: false,
      motivo: bloquea
        ? `Llegaste al limite de ${etiqueta} de tu plan (${limiteBase} + ${colchon} de colchon). Mejora a un plan superior para seguir.`
        : excedente > 0
          ? `${etiqueta}: excedente de ${excedente} (pay-per-use activo)`
          : estado === 'ADVERTENCIA'
            ? `${etiqueta}: estas en el colchon de gracia (${uso.cantidad}/${limiteGracia})`
            : `${etiqueta}: ${uso.cantidad}/${limiteBase}`,
    };
  }

  /** Verifica y lanza 403 si no se puede. */
  async exigirLimite(negocioId: string, recurso: RecursoLimitado, opts: VerificarLimiteOpts = {}) {
    const r = await this.verificarLimite(negocioId, recurso, opts);
    if (!r.permitido) {
      throw new ForbiddenException({
        message: r.motivo,
        recurso: r.recurso,
        estado: r.estado,
        limiteBase: r.limiteBase,
        limiteGracia: r.limiteGracia,
      });
    }
    return r;
  }

  /** Suma uso tras una creacion confirmada. */
  async incrementarUso(negocioId: string, recurso: RecursoLimitado, delta = 1, sucursalId: string | null = null) {
    const r = await this.uso.incrementar(negocioId, recurso, delta, sucursalId);
    if (r.estado === 'EXCEDIDO' && r.excedente > 0) {
      this.logger.warn(`Excedente en ${recurso} de ${negocioId}: ${r.excedente}`);
    }
    return r;
  }

  async decrementarUso(negocioId: string, recurso: RecursoLimitado, delta = 1) {
    return this.uso.decrementarUso(negocioId, recurso, delta, null);
  }

  /** Verificacion de una feature condicional (p. ej. delivery segun el tipo). */
  async exigirFeature(negocioId: string, feature: string) {
    if (await this.plan.estaSuspendido(negocioId)) {
      throw new ForbiddenException('El negocio esta suspendido. Contacta al soporte.');
    }
    const plan = await this.plan.planDeNegocio(negocioId);
    if (!(await this.plan.tieneFeature(plan, feature))) {
      throw new ForbiddenException(
        `Tu plan ${plan} no incluye "${feature}". Mejora a un plan superior para usar esta funcion.`,
      );
    }
    return true;
  }

  /** Detalle del plan + uso del negocio (endpoint del dueno). */
  async resumenPlan(negocioId: string, periodo = periodoActual()) {
    const plan = await this.plan.planDeNegocio(negocioId);
    const features = await this.plan.obtenerFeatures(plan);
    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { plan: true, payPerUseActivo: true, activo: true, suscripcion: { select: { estado: true, plan: true } } },
    });
    const colchon = await this.uso.colchonDe(negocioId);

    const limites = [];
    for (const recurso of Object.keys(RECURSO_A_FEATURE) as RecursoLimitado[]) {
      const r = await this.verificarLimite(negocioId, recurso, { incremento: 0, periodo });
      limites.push({
        recurso, ...r, mensual: esMensual(recurso), etiqueta: RECURSO_A_FEATURE[recurso],
      });
    }
    return { plan, colchonGracia: colchon, periodo, negocio: neg, features, limites };
  }

  async detalleUso(negocioId: string, periodo = periodoActual()) {
    const filas = await this.prisma.usoMensual.findMany({
      where: { negocioId, periodo }, orderBy: { recurso: 'asc' },
    });
    return { periodo, data: filas, total: filas.length };
  }
}