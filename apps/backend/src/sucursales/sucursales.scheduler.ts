import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SucursalesService } from './sucursales.service';

/**
 * El #2.10 pide 2 crons. Igual que en #2.8/#2.9: la logica vive en el servicio y
 * aca solo se la invoca.
 *
 * NOTA: el reporte del domingo se REGISTRA en EventoAuditoria pero NO se manda
 * email todavia: en el monorepo no hay proveedor de email (pendiente del #32 /
 * Resend). Queda todo el detalle listo para enviarlo retroactivamente.
 */
@Injectable()
export class SucursalesScheduler {
  private readonly logger = new Logger('SucursalesScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sucursales: SucursalesService,
  ) {}

  /** 2 AM: cada negocio debe tener exactamente 1 principal, y sin empleados en sucursales inactivas. */
  @Cron('0 2 * * *', { name: 'sucursales-reconciliacion' })
  async reconciliacionDiaria() {
    try {
      const negocios = await this.prisma.negocio.findMany({ where: { activo: true }, select: { id: true, slug: true } });
      let corregidos = 0;
      for (const n of negocios) {
        const r = await this.sucursales.reconciliarPrincipales(n.id);
        if (r.corregido) {
          corregidos++;
          this.logger.warn(`${n.slug}: ${r.motivo} -> principal ${r.nuevaPrincipalId}`);
        }
      }

      const enInactivas = await this.prisma.empleado.findMany({
        where: { activo: true, eliminadoEn: null, sucursal: { activa: false } },
        select: { id: true, nombre: true, sucursalId: true, negocioId: true },
      });
      if (enInactivas.length) {
        this.logger.warn(`${enInactivas.length} empleado(s) activo(s) en sucursales inactivas: ${enInactivas.map((e) => e.nombre).join(', ')}`);
      }

      this.logger.log(`Reconciliacion diaria: ${negocios.length} negocio(s), ${corregidos} principal(es) corregida(s)`);
    } catch (e) {
      this.logger.error(`reconciliacionDiaria fallo: ${(e as Error).message}`);
    }
  }

  /** Domingos 6 AM: reporte semanal por sucursal (queda en auditoria; el email es del #32). */
  @Cron('0 6 * * 0', { name: 'sucursales-reporte-semanal' })
  async reporteSemanal() {
    try {
      const negocios = await this.prisma.negocio.findMany({ where: { activo: true }, select: { id: true, nombre: true } });
      let generados = 0;
      for (const n of negocios) {
        const { data } = await this.sucursales.listar(n.id, {});
        if (!data.length) continue;
        await this.prisma.eventoAuditoria.create({
          data: {
            negocioId: n.id, accion: 'sucursal.reporte_semanal',
            detalle: {
              sucursales: data.map((s) => ({
                nombre: s.nombre, slug: s.slug, activa: s.activa, esPrincipal: s.esPrincipal,
                empleadosActivos: s.empleadosActivos, pedidosDelMes: s.pedidosDelMes,
                visitasDelMes: s.visitasDelMes, tieneConfiguracionOverride: s.tieneConfiguracionOverride,
              })),
              // Para el email del #32:
              asunto: `Resumen semanal de sucursales - ${n.nombre}`,
              cuerpo: data.map((s) => `${s.nombre}${s.esPrincipal ? ' (principal)' : ''}: ${s.pedidosDelMes} pedido(s), ${s.visitasDelMes} visita(s)`).join('\n'),
            },
          },
        });
        generados++;
      }
      this.logger.log(`Reportes semanales de sucursal generados: ${generados}`);
    } catch (e) {
      this.logger.error(`reporteSemanal fallo: ${(e as Error).message}`);
    }
  }
}