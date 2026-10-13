import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Plan, Prisma, RecursoLimitado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { FeatureCacheada } from './interfaces/feature-check.interface';
import { CATALOGO_FEATURES, CLAVES_FEATURES, PLANES_ORDEN } from './catalogo-features';
import type { TipoFeatureCatalogo } from './catalogo-features';

export const CACHE_FEATURES = (plan: Plan) => `plan:features:${plan}`;
export const TTL_FEATURES = 600; // 10 min

/**
 * RecursoLimitado -> nombre de feature en PlanFeature.
 *
 * Son 1:1 con el enum en minusculas (verificado contra el seed):
 *   CLIENTES -> 'clientes' | ITEMS_CARTA -> 'items_carta' | ...
 * No hace falta tabla intermedia.
 */
export const RECURSO_A_FEATURE: Record<RecursoLimitado, string> = {
  CLIENTES: 'clientes',
  EMPLEADOS: 'empleados',
  SUCURSALES: 'sucursales',
  ITEMS_CARTA: 'items_carta',
  PEDIDOS_MES: 'pedidos_mes',
  CAMPANAS_PUSH_MES: 'campanas_push_mes',
};

/**
 * Fallback si la feature no existe en BD. Se elige el valor MAS RESTRICTIVO
 * (no habilitada / limite 0) para que un dato faltante no abra una puerta.
 */
const FALLBACK: FeatureCacheada = { feature: '__desconocida__', habilitada: false, limite: 0 };

/** Recursos que se resetean cada mes; el resto es acumulativo. */
export const RECURSOS_MENSUALES: RecursoLimitado[] = ['PEDIDOS_MES', 'CAMPANAS_PUSH_MES'];
export const RECURSOS_ACUMULATIVOS: RecursoLimitado[] = ['CLIENTES', 'EMPLEADOS', 'SUCURSALES', 'ITEMS_CARTA'];

export function esMensual(recurso: RecursoLimitado) {
  return RECURSOS_MENSUALES.includes(recurso);
}

/**
 * Colchon de gracia PROPORCIONAL con tope.
 *
 *   limiteGracia = limiteBase + min(colchonGraciaDefault, ceil(limiteBase * 0.5))
 *
 * Antes era en USOS ABSOLUTOS (limiteBase + colchon), y con limites chicos dejaba
 * el gating decorativo: FREE sucursales = 1 permitia crear 51.
 *
 *   1 -> 2 | 100 -> 150 | 500 -> 550 | 5000 -> 5050
 *
 * limiteBase = 0 (recurso no incluido en el plan) -> gracia 0: el primer uso excede.
 */
export function calcularLimiteGracia(limiteBase: number, colchonConfigurado = 50): number {
  if (limiteBase <= 0) return 0;
  return Math.ceil(limiteBase * 0.5) < colchonConfigurado
    ? Math.ceil(limiteBase * 0.5)
    : colchonConfigurado;
}

/** limiteGracia final (base + colchon). */
export function limiteGraciaDe(limiteBase: number, colchonConfigurado = 50): number {
  return limiteBase + calcularLimiteGracia(limiteBase, colchonConfigurado);
}

/** Periodo YYYY-MM (hora local). */
export function periodoActual(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================================
// TIPOS del catalogo y del plan por negocio (los consume el panel de plataforma)
// ============================================================================

/** Una entrada del catalogo: la metadata + lo que dice el motor para cada plan. */
export interface FeatureCatalogo {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  tipo: TipoFeatureCatalogo;
  /** Planes donde la feature esta `habilitada` (se calcula contra `PlanFeature`, no se hardcodea). */
  planesIncluidos: Plan[];
  /** `limite` de la feature en cada plan (null = ilimitado o sin fila). */
  limitesPorPlan: Record<Plan, number | null>;
}

/** Lo vigente de un negocio: su plan efectivo, sus features y su pay-per-use. */
export interface EstadoPlanNegocio {
  plan: Plan;
  features: Record<string, { habilitada: boolean; limite: number | null }>;
  payPerUseActivo: boolean;
}

/** Un cambio de una feature puntual (`habilitada` + `limite` opcional). */
export interface CambioFeaturePlan {
  habilitada: boolean;
  limite?: number | null;
}

/** Body de `PATCH /superadmin/locales/:negocioId/plan`. */
export interface DtoPlanNegocio {
  plan?: Plan;
  features?: Record<string, CambioFeaturePlan>;
  payPerUseActivo?: boolean;
}

/** Contexto del operador que aplica el cambio (para que quede auditado como super-admin). */
export interface CtxPlanSuperAdmin {
  superAdminId: string;
  ip?: string;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger('PlanService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Features del plan, desde Redis (TTL 10 min) o BD. */
  async obtenerFeatures(plan: Plan): Promise<FeatureCacheada[]> {
    const clave = CACHE_FEATURES(plan);
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) {
      try {
        return JSON.parse(cacheado) as FeatureCacheada[];
      } catch {
        await this.redis.del(clave).catch(() => undefined);
      }
    }

    const filas = await this.prisma.planFeature.findMany({
      where: { plan },
      select: { feature: true, habilitada: true, limite: true },
    });
    const features: FeatureCacheada[] = filas.map((f) => ({
      feature: f.feature, habilitada: f.habilitada, limite: f.limite,
    }));

    await this.redis.set(clave, JSON.stringify(features), TTL_FEATURES).catch(() => undefined);
    return features;
  }

  async tieneFeature(plan: Plan, feature: string): Promise<boolean> {
    const features = await this.obtenerFeatures(plan);
    const f = features.find((x) => x.feature === feature);
    if (!f) {
      // Fallback restrictivo: una feature que no existe NO esta habilitada.
      this.logger.warn(`Feature "${feature}" no existe para el plan ${plan}; se niega por defecto`);
      return false;
    }
    return f.habilitada;
  }

  /** Limite del recurso. null = ilimitado. */
  async obtenerLimite(plan: Plan, recurso: RecursoLimitado): Promise<number | null> {
    const feature = RECURSO_A_FEATURE[recurso];
    const features = await this.obtenerFeatures(plan);
    const f = features.find((x) => x.feature === feature);
    if (!f) {
      this.logger.warn(`Recurso ${recurso} (feature "${feature}") no existe para el plan ${plan}`);
      return FALLBACK.limite;
    }
    if (!f.habilitada) return 0;
    return f.limite;
  }

  async obtenerTodasLasFeatures(): Promise<Record<string, FeatureCacheada[]>> {
    const planes: Plan[] = ['FREE', 'BASIC', 'PRO'];
    const pares = await Promise.all(planes.map(async (p) => [p, await this.obtenerFeatures(p)] as const));
    return Object.fromEntries(pares);
  }

  /** Plan efectivo del negocio (Negocio.plan; la Suscripcion puede pisarlo). */
  async planDeNegocio(negocioId: string): Promise<Plan> {
    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { plan: true, suscripcion: { select: { plan: true, estado: true } } },
    });
    if (!neg) throw new NotFoundException('Negocio no encontrado');
    const s = neg.suscripcion;
    if (s && (s.estado === 'ACTIVA' || s.estado === 'TRIAL')) return s.plan;
    return neg.plan;
  }

  async estaSuspendido(negocioId: string): Promise<boolean> {
    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { activo: true, suscripcion: { select: { estado: true } } },
    });
    if (!neg) return true;
    if (!neg.activo) return true;
    const e = neg.suscripcion?.estado;
    return e === 'CANCELADA' || e === 'VENCIDA' || e === 'PAUSADA';
  }

  // --------- CUD de features (los cablea el #9 Super-Admin) ---------

  /**
   * Actualiza una feature y invalida el cache. Lo llama el #9 (Super-Admin).
   *
   * `auditarComo` decide DONDE queda el registro:
   *   'negocio'      -> EventoAuditoria       (requiere ctx.negocioId)
   *   'super-admin'  -> EventoAuditoriaSuperAdmin (requiere ctx.superAdminId)
   * El default es 'negocio' para no cambiar el comportamiento actual; el #9 pasa
   * 'super-admin', que es el caso real (un cambio de plan es de plataforma y no
   * pertenece a ningun negocio).
   */
  async actualizarFeature(
    plan: Plan, feature: string,
    dto: { habilitada?: boolean; limite?: number | null },
    ctx?: {
      empleadoId?: string; negocioId?: string; ip?: string;
      auditarComo?: 'negocio' | 'super-admin'; superAdminId?: string;
    },
  ) {
    const datos: Prisma.PlanFeatureUpdateInput = {};
    if (dto.habilitada !== undefined) datos.habilitada = dto.habilitada;
    if (dto.limite !== undefined) datos.limite = dto.limite;

    const existente = await this.prisma.planFeature.findUnique({
      where: { plan_feature: { plan, feature } },
      select: { id: true },
    });

    const fila = existente
      ? await this.prisma.planFeature.update({
          where: { plan_feature: { plan, feature } }, data: datos,
        })
      : await this.prisma.planFeature.create({
          data: {
            plan, feature,
            habilitada: dto.habilitada ?? false,
            limite: dto.limite ?? null,
          },
        });

    await this.invalidar(plan);

    const detalle = { plan, feature, habilitada: fila.habilitada, limite: fila.limite, creada: !existente };
    const como = ctx?.auditarComo ?? 'negocio';

    // EventoAuditoria.negocioId es OBLIGATORIO, asi que un cambio de plan (que no
    // pertenece a ningun negocio) NO se puede registrar ahi: el #9 pasa
    // auditarComo: 'super-admin' y el evento va a EventoAuditoriaSuperAdmin.
    // Siempre queda ademas el log del server.
    this.logger.log(`plan.feature_actualizada [${como}] ${plan}/${feature} -> ${JSON.stringify(detalle)}`);

    if (como === 'super-admin') {
      if (!ctx?.superAdminId) {
        this.logger.warn('auditarComo=super-admin sin superAdminId: el evento no se registra');
      } else {
        await this.auditoria.registrarSuperAdmin({
          superAdminId: ctx.superAdminId, negocioId: ctx.negocioId ?? null,
          accion: 'plan.feature_actualizada', ip: ctx.ip, detalle,
        });
      }
    } else if (ctx?.negocioId) {
      await this.auditoria.registrar({
        negocioId: ctx.negocioId, accion: 'plan.feature_actualizada',
        empleadoId: ctx?.empleadoId, ip: ctx?.ip, detalle,
      });
    }
    return fila;
  }

  /** Pay-per-use por negocio. Lo llama el #9. */
  async setPayPerUse(
    negocioId: string, activo: boolean,
    ctx?: { empleadoId?: string; ip?: string; auditarComo?: 'negocio' | 'super-admin'; superAdminId?: string },
  ) {
    const neg = await this.prisma.negocio.update({
      where: { id: negocioId }, data: { payPerUseActivo: activo },
      select: { id: true, payPerUseActivo: true },
    });
    const accion = activo ? 'plan.pay_per_use_activado' : 'plan.pay_per_use_desactivado';
    this.logger.log(`${accion} negocio=${negocioId}`);
    if ((ctx?.auditarComo ?? 'negocio') === 'super-admin' && ctx?.superAdminId) {
      await this.auditoria.registrarSuperAdmin({
        superAdminId: ctx.superAdminId, negocioId, accion, ip: ctx.ip, detalle: { negocioId },
      });
    } else {
      await this.auditoria.registrar({
        negocioId, accion, empleadoId: ctx?.empleadoId, ip: ctx?.ip, detalle: { negocioId },
      });
    }
    return neg;
  }

  /** Invalidacion de cache. */
  async invalidar(plan: Plan) {
    await this.redis.del(CACHE_FEATURES(plan)).catch(() => undefined);
  }

  async invalidarTodo() {
    for (const p of ['FREE', 'BASIC', 'PRO'] as Plan[]) {
      await this.redis.del(CACHE_FEATURES(p)).catch(() => undefined);
    }
  }

  // =========================================================================
  // CATALOGO + PLAN POR NEGOCIO (los cablea el panel de plataforma)
  // =========================================================================

  /**
   * El CATALOGO de features: la metadata (clave/etiqueta/descripcion) + lo que dice el
   * motor para cada plan. `planesIncluidos` y `limitesPorPlan` salen de `PlanFeature`
   * (la fuente de verdad), NO de una lista hardcodeada: si el seed o la DB cambian, el
   * catalogo lo refleja solo.
   */
  async catalogoFeatures(): Promise<FeatureCatalogo[]> {
    const porPlan = await this.obtenerTodasLasFeatures();
    return CATALOGO_FEATURES.map((def) => {
      const limitesPorPlan = {} as Record<Plan, number | null>;
      const planesIncluidos: Plan[] = [];
      for (const p of PLANES_ORDEN) {
        const f = (porPlan[p] ?? []).find((x) => x.feature === def.clave);
        limitesPorPlan[p] = f?.limite ?? null;
        if (f?.habilitada) planesIncluidos.push(p);
      }
      const item: FeatureCatalogo = {
        clave: def.clave,
        etiqueta: def.etiqueta,
        tipo: def.tipo,
        planesIncluidos,
        limitesPorPlan,
      };
      if (def.descripcion) item.descripcion = def.descripcion;
      return item;
    });
  }

  /** Lo VIGENTE de un negocio: su plan efectivo + sus features + su pay-per-use. */
  async estadoPlanNegocio(negocioId: string): Promise<EstadoPlanNegocio> {
    const plan = await this.planDeNegocio(negocioId);
    const features = await this.obtenerFeatures(plan);
    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { payPerUseActivo: true },
    });
    return {
      plan,
      features: Object.fromEntries(
        features.map((f) => [f.feature, { habilitada: f.habilitada, limite: f.limite }]),
      ),
      payPerUseActivo: neg?.payPerUseActivo ?? false,
    };
  }

  /**
   * Aplica un cambio de plan/features/pay-per-use sobre un negocio ENVOLVIENDO el motor
   * que ya existe (`actualizarFeature` y `setPayPerUse`): no reimplementa la escritura ni
   * la auditoria. Los tres bloques se auditican como `super-admin`
   * (`EventoAuditoriaSuperAdmin`), que es el caso real: un cambio de plan es de plataforma
   * y no pertenece a ningun negocio.
   *
   * OJO: `features` setea la fila del PLAN (global), no un override por negocio. Es la
   * semantica del motor actual (no hay tabla de features por negocio). El `PATCH` cambia
   * el plan del local y, si se piden features, las del plan resultante.
   */
  async aplicarPlanNegocio(
    negocioId: string,
    dto: DtoPlanNegocio,
    ctx: CtxPlanSuperAdmin,
  ): Promise<EstadoPlanNegocio> {
    const neg = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { id: true },
    });
    if (!neg) throw new NotFoundException('Negocio no encontrado');

    if (dto.features) {
      for (const [clave, cfg] of Object.entries(dto.features)) {
        if (!CLAVES_FEATURES.has(clave)) {
          throw new BadRequestException(`Feature desconocida: ${clave}`);
        }
        if (typeof cfg?.habilitada !== 'boolean') {
          throw new BadRequestException(`features.${clave}.habilitada debe ser boolean`);
        }
        const lim = cfg.limite;
        if (lim !== undefined && lim !== null && (!Number.isInteger(lim) || lim < 0)) {
          throw new BadRequestException(`features.${clave}.limite debe ser un entero >= 0 o null`);
        }
      }
    }

    if (dto.plan !== undefined) {
      await this.prisma.negocio.update({ where: { id: negocioId }, data: { plan: dto.plan } });
    }

    // El plan EFECTIVO (una Suscripcion ACTIVA/TRIAL puede pisar `Negocio.plan`): sobre ese
    // se setean las features, para que lo que se edita sea lo mismo que se muestra en el GET.
    const plan = await this.planDeNegocio(negocioId);

    if (dto.features) {
      for (const [clave, cfg] of Object.entries(dto.features)) {
        await this.actualizarFeature(
          plan,
          clave,
          { habilitada: cfg.habilitada, ...(cfg.limite !== undefined ? { limite: cfg.limite } : {}) },
          { auditarComo: 'super-admin', superAdminId: ctx.superAdminId, negocioId, ip: ctx.ip },
        );
      }
    }

    if (dto.payPerUseActivo !== undefined) {
      await this.setPayPerUse(negocioId, dto.payPerUseActivo, {
        auditarComo: 'super-admin',
        superAdminId: ctx.superAdminId,
        ip: ctx.ip,
      });
    }

    return this.estadoPlanNegocio(negocioId);
  }
}