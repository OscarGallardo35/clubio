import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';

export interface ResultadoMigracion {
  negociosRevisados: number;
  sucursalesCreadas: number;
  principalesMarcadas: number;
  tokensHuérfanos: number;
  tokensBackfilleados: number;
  detalles: string[];
}

/**
 * Migracion one-shot (Fase 2 del Prompt #1.3) e IDEMPOTENTE: se puede correr las
 * veces que haga falta.
 *
 * Hace tres cosas:
 *   1. Cada negocio con sucursales pero SIN principal -> marca la primera activa.
 *   2. Cada negocio SIN ninguna sucursal -> le crea "Principal" (esPrincipal).
 *   3. Backfill de TokenValidacion.sucursalId -> principal del negocio.
 *
 * Hoy (1) y (3) no tienen trabajo pendiente: verificado, 10/10 tokens ya tienen
 * sucursalId. El metodo queda para produccion.
 */
@Injectable()
export class MigracionSucursalService {
  private readonly logger = new Logger('MigracionSucursal');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async ejecutar(): Promise<ResultadoMigracion> {
    const r: ResultadoMigracion = {
      negociosRevisados: 0, sucursalesCreadas: 0, principalesMarcadas: 0,
      tokensHuérfanos: 0, tokensBackfilleados: 0, detalles: [],
    };

    const negocios = await this.prisma.negocio.findMany({
      select: { id: true, nombre: true, slug: true },
      orderBy: { creadoEn: 'asc' },
    });
    r.negociosRevisados = negocios.length;

    for (const neg of negocios) {
      const sucursales = await this.prisma.sucursal.findMany({
        where: { negocioId: neg.id },
        orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
        select: { id: true, esPrincipal: true, activa: true, nombre: true },
      });

      // (2) sin sucursales -> crear la Principal
      if (!sucursales.length) {
        const creada = await this.prisma.sucursal.create({
          data: {
            negocioId: neg.id, nombre: 'Principal', slug: 'principal',
            esPrincipal: true, activa: true,
          },
        });
        r.sucursalesCreadas++;
        r.principalesMarcadas++;
        r.detalles.push(`${neg.slug}: creada sucursal "Principal" (${creada.id})`);
        await this.auditoria.registrar({
          negocioId: neg.id, accion: 'sucursal.migracion_principal_creada',
          detalle: { sucursalId: creada.id },
        });
        continue;
      }

      // (1) hay sucursales pero 0 o +1 principales -> dejar exactamente una
      const principales = sucursales.filter((s) => s.esPrincipal && s.activa);
      if (principales.length !== 1) {
        const elegida = principales[0] ?? sucursales.find((s) => s.activa) ?? sucursales[0];
        await this.prisma.$transaction([
          this.prisma.sucursal.updateMany({ where: { negocioId: neg.id }, data: { esPrincipal: false } }),
          this.prisma.sucursal.update({ where: { id: elegida.id }, data: { esPrincipal: true } }),
        ]);
        r.principalesMarcadas++;
        r.detalles.push(`${neg.slug}: ${principales.length} principal(es) -> "${elegida.nombre}"`);
        await this.auditoria.registrar({
          negocioId: neg.id, accion: 'sucursal.migracion_principal_corregida',
          detalle: { sucursalId: elegida.id, principalesAntes: principales.length },
        });
      }
    }

    // (3) backfill de tokens sin sucursalId
    const huerfanos = await this.prisma.tokenValidacion.findMany({
      where: { sucursalId: null },
      select: { id: true, negocioId: true },
    });
    r.tokensHuérfanos = huerfanos.length;

    for (const t of huerfanos) {
      const principal = await this.prisma.sucursal.findFirst({
        where: { negocioId: t.negocioId, esPrincipal: true, activa: true },
        select: { id: true },
      });
      if (!principal) continue;
      await this.prisma.tokenValidacion.update({
        where: { id: t.id }, data: { sucursalId: principal.id },
      });
      r.tokensBackfilleados++;
    }
    if (r.tokensBackfilleados) {
      r.detalles.push(`backfill: ${r.tokensBackfilleados} token(s) -> principal del negocio`);
    }

    this.logger.log(`Migracion: ${JSON.stringify(r)}`);
    return r;
  }

  /** Solo diagnostico, sin escribir nada. */
  async diagnostico() {
    const [negocios, sinSucursal, multiplesPrincipales, tokensHuerfanos, empleadosEnInactivas] = await Promise.all([
      this.prisma.negocio.count(),
      this.prisma.negocio.count({ where: { sucursales: { none: {} } } }),
      this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::int AS n FROM (SELECT "negocioId" FROM "Sucursal" GROUP BY "negocioId" HAVING count(*) FILTER (WHERE "esPrincipal") <> 1) t`,
      ).then((r) => Number(r[0]?.n ?? 0)),
      this.prisma.tokenValidacion.count({ where: { sucursalId: null } }),
      this.prisma.empleado.count({ where: { activo: true, eliminadoEn: null, sucursal: { activa: false } } }),
    ]);
    return { negocios, negociosSinSucursal: sinSucursal, negociosConPrincipalesInconsistentes: multiplesPrincipales, tokensSinSucursal: tokensHuerfanos, empleadosEnSucursalesInactivas: empleadosEnInactivas };
  }
}