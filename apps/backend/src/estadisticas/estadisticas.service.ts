import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

const CACHE_TTL = 300; // 5 min

export interface DashboardCtx {
  sucursalId?: string | null;
}

@Injectable()
export class EstadisticasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private rangoDia(offsetDias = 0) {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() + offsetDias);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 1);
    return { desde, hasta };
  }

  /** Variacion porcentual (null si no hay base de comparacion). */
  private variacion(hoy: number, ayer: number): number | null {
    if (ayer === 0) return hoy === 0 ? 0 : null;
    return Number((((hoy - ayer) / ayer) * 100).toFixed(1));
  }

  /**
   * KPIs del dia con comparacion contra ayer.
   *
   * Eficiencia: TODO se resuelve con agregaciones y groupBy de Prisma en
   * paralelo. No hay un bucle por sucursal ni por cliente (nada de N+1).
   */
  async dashboard(negocioId: string, ctx: DashboardCtx = {}) {
    const clave = `estadisticas:dashboard:${negocioId}:${ctx.sucursalId ?? 'todas'}`;
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) return { ...JSON.parse(cacheado), cacheado: true };

    const hoy = this.rangoDia(0);
    const ayer = this.rangoDia(-1);
    const base = { negocioId, ...(ctx.sucursalId ? { sucursalId: ctx.sucursalId } : {}) };

    const [
      visitasHoy, visitasAyer,
      clientesHoy, clientesAyer,
      sellosHoy, sellosAyer,
      porSucursal, porEtiqueta,
      serie, pendientes,
    ] = await Promise.all([
      this.prisma.visita.count({ where: { ...base, aprobadoEn: { gte: hoy.desde, lt: hoy.hasta } } }),
      this.prisma.visita.count({ where: { ...base, aprobadoEn: { gte: ayer.desde, lt: ayer.hasta } } }),
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null, creadoEn: { gte: hoy.desde, lt: hoy.hasta } } }),
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null, creadoEn: { gte: ayer.desde, lt: ayer.hasta } } }),
      this.prisma.visita.aggregate({
        where: { ...base, aprobadoEn: { gte: hoy.desde, lt: hoy.hasta } },
        _sum: { sellosOtorgados: true, puntosOtorgados: true },
        _avg: { montoConsumido: true },
      }),
      this.prisma.visita.aggregate({
        where: { ...base, aprobadoEn: { gte: ayer.desde, lt: ayer.hasta } },
        _sum: { sellosOtorgados: true },
      }),
      // groupBy: una sola query para todas las sucursales
      this.prisma.visita.groupBy({
        by: ['sucursalId'],
        where: { negocioId, aprobadoEn: { gte: hoy.desde, lt: hoy.hasta } },
        _count: { _all: true },
        _sum: { sellosOtorgados: true },
      }),
      this.prisma.cliente.groupBy({
        by: ['etiqueta'],
        where: { negocioId, eliminadoEn: null },
        _count: { _all: true },
      }),
      // serie de 7 dias con date_trunc: 1 query, no 7
      this.prisma.$queryRaw<Array<{ dia: Date; total: bigint }>>`
        SELECT date_trunc('day', "aprobadoEn") AS dia, COUNT(*)::bigint AS total
        FROM "Visita"
        WHERE "negocioId" = ${negocioId}
          AND "aprobadoEn" >= ${new Date(Date.now() - 6 * 86_400_000)}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      this.prisma.tokenValidacion.count({
        where: { negocioId, usado: false, expiraEn: { gt: new Date() } },
      }),
    ]);

    const sucursales = porSucursal.length
      ? await this.prisma.sucursal.findMany({
          where: { id: { in: porSucursal.map((s) => s.sucursalId) } },
          select: { id: true, nombre: true, slug: true },
        })
      : [];
    const nombrePorId = new Map(sucursales.map((s) => [s.id, s]));

    const respuesta = {
      fecha: hoy.desde.toISOString().slice(0, 10),
      kpis: {
        visitasHoy,
        visitasAyer,
        variacionVisitas: this.variacion(visitasHoy, visitasAyer),
        clientesNuevosHoy: clientesHoy,
        clientesNuevosAyer: clientesAyer,
        variacionClientes: this.variacion(clientesHoy, clientesAyer),
        sellosOtorgadosHoy: sellosHoy._sum.sellosOtorgados ?? 0,
        sellosOtorgadosAyer: sellosAyer._sum.sellosOtorgados ?? 0,
        puntosOtorgadosHoy: sellosHoy._sum.puntosOtorgados ?? 0,
        ticketPromedio: Number(Number(sellosHoy._avg.montoConsumido ?? 0).toFixed(2)),
        solicitudesPendientes: pendientes,
      },
      porSucursal: porSucursal.map((s) => ({
        sucursalId: s.sucursalId,
        nombre: nombrePorId.get(s.sucursalId)?.nombre ?? '(desconocida)',
        slug: nombrePorId.get(s.sucursalId)?.slug ?? null,
        visitas: s._count._all,
        sellos: s._sum.sellosOtorgados ?? 0,
      })),
      clientesPorEtiqueta: porEtiqueta.map((e) => ({ etiqueta: e.etiqueta, total: e._count._all })),
      serie7Dias: serie.map((s) => ({
        dia: new Date(s.dia).toISOString().slice(0, 10),
        visitas: Number(s.total),
      })),
      cacheado: false,
    };

    await this.redis.set(clave, JSON.stringify(respuesta), CACHE_TTL).catch(() => undefined);
    return respuesta;
  }

  /** Ranking de clientes por visitas (groupBy + un solo findMany para los nombres). */
  async topClientes(negocioId: string, limite = 10) {
    const agrupado = await this.prisma.visita.groupBy({
      by: ['clienteId'],
      where: { negocioId },
      _count: { _all: true },
      orderBy: { _count: { clienteId: 'desc' } },
      take: Math.min(50, Math.max(1, limite)),
    });
    if (!agrupado.length) return { data: [] };

    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: agrupado.map((a) => a.clienteId) } },
      select: { id: true, nombre: true, etiqueta: true, sellosActuales: true },
    });
    const porId = new Map(clientes.map((c) => [c.id, c]));

    return {
      data: agrupado.map((a) => ({
        clienteId: a.clienteId,
        nombre: porId.get(a.clienteId)?.nombre ?? '(eliminado)',
        etiqueta: porId.get(a.clienteId)?.etiqueta ?? null,
        sellosActuales: porId.get(a.clienteId)?.sellosActuales ?? 0,
        visitas: a._count._all,
      })),
    };
  }

  /** Invalida el cache del dashboard (se llama tras aprobar una visita). */
  async invalidar(negocioId: string) {
    await this.redis.del(`estadisticas:dashboard:${negocioId}:todas`).catch(() => undefined);
  }
}