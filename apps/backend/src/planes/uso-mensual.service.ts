import { Injectable } from '@nestjs/common';
import { EstadoUso, Prisma, RecursoLimitado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { PlanService, RECURSO_A_FEATURE, esMensual, limiteGraciaDe, periodoActual } from './plan.service';

export const COLCHON_DEFAULT = 50;
/** Recurso -> campo del evento de auditoria (para el email retroactivo del #32). */
export interface UmbralAviso {
  negocioId: string;
  recurso: RecursoLimitado;
  periodo: string;
  cantidad: number;
  limiteBase: number;
  limiteGracia: number;
  estado: EstadoUso;
}

@Injectable()
export class UsoMensualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * OJO: `UsoMensual` tiene @@unique([negocioId, sucursalId, recurso, periodo])
   * pero sucursalId es NULLABLE. En Postgres los NULL no colisionan entre si, asi
   * que ese unique NO impide filas duplicadas con sucursalId=null, y Prisma no
   * acepta null en el `where` de un unique compuesto. Por eso se busca con
   * findFirst y se crea a mano (con reintento si dos requests empatan en P2002).
   */
  async obtenerOCrearUso(
    negocioId: string, recurso: RecursoLimitado,
    periodo = periodoActual(), sucursalId: string | null = null,
  ) {
    const existente = await this.prisma.usoMensual.findFirst({
      where: { negocioId, recurso, periodo, sucursalId },
    });
    if (existente) return existente;

    const plan = await this.plan.planDeNegocio(negocioId);
    const limite = await this.plan.obtenerLimite(plan, recurso);
    const colchon = await this.colchonDe(negocioId);
    const limiteBase = limite ?? 0;
    const ilimitado = limite === null;
    const gracia = limiteGraciaDe(limiteBase, colchon);

    try {
      return await this.prisma.usoMensual.create({
        data: {
          negocioId, sucursalId, recurso, periodo,
          cantidad: 0,
          // limiteBase=0 + ilimitado: se guarda -1 para distinguir "ilimitado"
          limiteBase: ilimitado ? 0 : limiteBase,
          limiteGracia: ilimitado ? 0 : gracia,
          estado: 'NORMAL',
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const otra = await this.prisma.usoMensual.findFirst({
          where: { negocioId, recurso, periodo, sucursalId },
        });
        if (otra) return otra;
      }
      throw e;
    }
  }

  async colchonDe(negocioId: string): Promise<number> {
    const cfg = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { colchonGraciaDefault: true },
    });
    return cfg?.colchonGraciaDefault ?? COLCHON_DEFAULT;
  }

  /** Suma (o resta) uso. Devuelve el registro actualizado + si hay que avisar. */
  async incrementar(negocioId: string, recurso: RecursoLimitado, delta = 1, sucursalId: string | null = null) {
    const uso = await this.obtenerOCrearUso(negocioId, recurso, periodoActual(), sucursalId);
    const cantidad = Math.max(0, uso.cantidad + delta);

    const { estado, excedente } = this.calcularEstado(cantidad, uso.limiteBase, uso.limiteGracia, uso.payPerUse);
    const actualizado = await this.prisma.usoMensual.update({
      where: { id: uso.id },
      data: { cantidad, estado, excedente },
    });

    await this.revisarUmbrales(actualizado);
    return actualizado;
  }

  async decrementarUso(negocioId: string, recurso: RecursoLimitado, delta = 1, sucursalId: string | null = null) {
    return this.incrementar(negocioId, recurso, -Math.abs(delta), sucursalId);
  }

  private calcularEstado(cantidad: number, limiteBase: number, limiteGracia: number, payPerUse: boolean) {
    if (limiteBase === 0 && limiteGracia === 0) {
      // Recurso no incluido en el plan: cualquier uso excede.
      return { estado: cantidad > 0 ? ('EXCEDIDO' as EstadoUso) : ('NORMAL' as EstadoUso), excedente: Math.max(0, cantidad) };
    }
    if (cantidad <= limiteBase) return { estado: 'NORMAL' as EstadoUso, excedente: 0 };
    if (cantidad <= limiteGracia) {
      return { estado: 'ADVERTENCIA' as EstadoUso, excedente: 0 };
    }
    return { estado: 'EXCEDIDO' as EstadoUso, excedente: cantidad - limiteGracia, payPerUse };
  }

  /**
   * Notifica al dueno al 100% y al 150%, UNA VEZ POR PERIODO (idempotente con
   * notificado100 / notificado150). Deja todo el detalle en EventoAuditoria para
   * que el #32 (Resend) pueda mandar el email retroactivo.
   */
  async revisarUmbrales(uso: {
    id: string; negocioId: string; recurso: RecursoLimitado; periodo: string;
    cantidad: number; limiteBase: number; limiteGracia: number;
    notificado100: boolean; notificado150: boolean;
  }) {
    const avisos: string[] = [];
    const campos: Prisma.UsoMensualUpdateInput = {};

    const paso100 = uso.limiteBase > 0 && uso.cantidad >= uso.limiteBase;
    const paso150 = uso.limiteGracia > 0 && uso.cantidad > uso.limiteGracia;

    if (paso100 && !uso.notificado100) {
      campos.notificado100 = true;
      avisos.push('100');
      await this.auditoria.registrar({
        negocioId: uso.negocioId, accion: 'plan.limite_alcanzado_100',
        detalle: {
          recurso: uso.recurso, periodo: uso.periodo, cantidad: uso.cantidad,
          limiteBase: uso.limiteBase, limiteGracia: uso.limiteGracia,
          umbral: 100, feature: RECURSO_A_FEATURE[uso.recurso],
          // Datos listos para el email retroactivo del #32:
          asunto: `Estas al 100% del limite de ${RECURSO_A_FEATURE[uso.recurso]}`,
          cuerpo: `Alcanzaste ${uso.cantidad} de ${uso.limiteBase} en ${RECURSO_A_FEATURE[uso.recurso]} (periodo ${uso.periodo}). Podes seguir usando hasta ${uso.limiteGracia} antes de que se bloquee. Mejora a un plan superior para ampliar el limite.`,
        },
      });
    }
    if (paso150 && !uso.notificado150) {
      campos.notificado150 = true;
      avisos.push('150');
      await this.auditoria.registrar({
        negocioId: uso.negocioId, accion: 'plan.limite_alcanzado_150',
        detalle: {
          recurso: uso.recurso, periodo: uso.periodo, cantidad: uso.cantidad,
          limiteBase: uso.limiteBase, limiteGracia: uso.limiteGracia,
          umbral: 150, feature: RECURSO_A_FEATURE[uso.recurso],
          asunto: `Pasaste el limite de ${RECURSO_A_FEATURE[uso.recurso]}`,
          cuerpo: `Usaste ${uso.cantidad} de ${uso.limiteBase} en ${RECURSO_A_FEATURE[uso.recurso]} (periodo ${uso.periodo}). Ya superaste el colchon de gracia (${uso.limiteGracia}).`,
        },
      });
    }

    if (Object.keys(campos).length) {
      await this.prisma.usoMensual.update({ where: { id: uso.id }, data: campos });
    }
    return { avisos, notificado100: paso100, notificado150: paso150 };
  }

  /** Recursos en ADVERTENCIA (>100% y <=150%) de un negocio. */
  async recursosEnAdvertencia(negocioId: string, periodo = periodoActual()) {
    return this.prisma.usoMensual.findMany({
      where: { negocioId, periodo, estado: 'ADVERTENCIA' },
      orderBy: { recurso: 'asc' },
    });
  }

  /**
   * Reset mensual (cron dia 1): crea los registros del periodo nuevo en 0 SOLO
   * para los recursos MENSUALES. Los acumulativos (CLIENTES, EMPLEADOS,
   * SUCURSALES, ITEMS_CARTA) NO se resetean: se copia su cantidad actual.
   * Los registros del periodo anterior se conservan (historico).
   */
  async resetearUsoMensual(periodo = periodoActual()) {
    const negocios = await this.prisma.negocio.findMany({
      where: { activo: true }, select: { id: true },
    });

    let creados = 0, acumulativosCopiados = 0;
    for (const neg of negocios) {
      const plan = await this.plan.planDeNegocio(neg.id);
      const colchon = await this.colchonDe(neg.id);

      for (const recurso of Object.keys(RECURSO_A_FEATURE) as RecursoLimitado[]) {
        const ya = await this.prisma.usoMensual.findFirst({
          where: { negocioId: neg.id, recurso, periodo, sucursalId: null },
          select: { id: true },
        });
        if (ya) continue;

        const limite = await this.plan.obtenerLimite(plan, recurso);
        const limiteBase = limite ?? 0;

        let cantidad = 0;
        if (!esMensual(recurso)) {
          // Acumulativo: se arrastra la cantidad del periodo anterior.
          const previo = await this.prisma.usoMensual.findFirst({
            where: { negocioId: neg.id, recurso, sucursalId: null, periodo: { lt: periodo } },
            orderBy: { periodo: 'desc' },
            select: { cantidad: true },
          });
          cantidad = previo?.cantidad ?? 0;
          acumulativosCopiados++;
        }

        const { estado, excedente } = this.calcularEstado(cantidad, limiteBase, limiteGraciaDe(limiteBase, colchon), false);
        await this.prisma.usoMensual.create({
          data: {
            negocioId: neg.id, sucursalId: null, recurso, periodo, cantidad,
            limiteBase, limiteGracia: limiteGraciaDe(limiteBase, colchon), estado, excedente,
          },
        });
        creados++;
      }

      await this.auditoria.registrar({
        negocioId: neg.id, accion: 'plan.uso_reseteado', detalle: { periodo },
      });
    }
    return { periodo, negocios: negocios.length, creados, acumulativosCopiados };
  }

  /** Recalcula el uso desde las tablas reales (reconciliacion semanal). */
  async sincronizarUsoActual(negocioId: string, periodo = periodoActual()) {
    const [clientes, empleados, sucursales, items, pedidos, campanas] = await Promise.all([
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null } }),
      this.prisma.empleado.count({ where: { negocioId, activo: true, eliminadoEn: null } }),
      this.prisma.sucursal.count({ where: { negocioId, activa: true } }),
      this.prisma.itemCarta.count({ where: { negocioId } }),
      this.prisma.pedido.count({ where: { negocioId, creadoEn: this.rangoPeriodo(periodo) } }),
      this.prisma.campanaMarketing.count({
        where: { negocioId, canal: 'PUSH', creadaEn: this.rangoPeriodo(periodo) },
      }).catch(() => 0),
    ]);

    const reales: Record<RecursoLimitado, number> = {
      CLIENTES: clientes, EMPLEADOS: empleados, SUCURSALES: sucursales,
      ITEMS_CARTA: items, PEDIDOS_MES: pedidos, CAMPANAS_PUSH_MES: campanas,
    };

    const desfases: Array<{ recurso: string; antes: number; real: number }> = [];
    for (const [recurso, cantidad] of Object.entries(reales) as Array<[RecursoLimitado, number]>) {
      const uso = await this.obtenerOCrearUso(negocioId, recurso, periodo, null);
      if (uso.cantidad === cantidad) continue;
      desfases.push({ recurso, antes: uso.cantidad, real: cantidad });
      const { estado, excedente } = this.calcularEstado(cantidad, uso.limiteBase, uso.limiteGracia, uso.payPerUse);
      await this.prisma.usoMensual.update({
        where: { id: uso.id }, data: { cantidad, estado, excedente },
      });
    }

    return { negocioId, periodo, desfases, corregidos: desfases.length };
  }

  /** Periodo YYYY-MM -> rango [inicio, fin). */
  private rangoPeriodo(periodo: string): Prisma.DateTimeFilter {
    const [y, m] = periodo.split('-').map(Number);
    return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
  }

  async historico(negocioId: string, meses = 6) {
    const periodos = await this.prisma.usoMensual.findMany({
      where: { negocioId },
      select: { periodo: true },
      distinct: ['periodo'],
      orderBy: { periodo: 'desc' },
      take: Math.max(1, Math.min(meses, 24)),
    });
    const lista = periodos.map((p) => p.periodo);
    const filas = await this.prisma.usoMensual.findMany({
      where: { negocioId, periodo: { in: lista } },
      orderBy: [{ periodo: 'desc' }, { recurso: 'asc' }],
    });
    return { periodos: lista, data: filas };
  }
}