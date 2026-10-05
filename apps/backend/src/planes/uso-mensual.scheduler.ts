import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { RECURSO_A_FEATURE, periodoActual } from './plan.service';
import { UsoMensualService } from './uso-mensual.service';

const ETIQUETA: Record<string, string> = {
  clientes: 'clientes', empleados: 'empleados', sucursales: 'sucursales',
  items_carta: 'items de carta', pedidos_mes: 'pedidos del mes',
  campanas_push_mes: 'campanas push del mes',
};

/**
 * Los 4 crons del #2.9. Igual que en #2.8: la logica vive en los servicios y
 * aca solo se la invoca, para poder testearla sin esperar al dia 1.
 */
@Injectable()
export class UsoMensualScheduler {
  private readonly logger = new Logger('UsoMensualScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly uso: UsoMensualService,
    private readonly push: PushService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Dia 1 a las 00:05: reset del periodo nuevo. */
  @Cron('5 0 1 * *', { name: 'planes-reset-mensual' })
  async resetMensual() {
    try {
      const r = await this.uso.resetearUsoMensual(periodoActual());
      this.logger.log(`Reset ${r.periodo}: ${r.negocios} negocio(s), ${r.creados} registro(s), ${r.acumulativosCopiados} acumulativos arrastrados`);
    } catch (e) {
      this.logger.error(`resetMensual fallo: ${(e as Error).message}`);
    }
  }

  /** 3 AM: recordatorio diario a los negocios en ADVERTENCIA. */
  @Cron('0 3 * * *', { name: 'planes-recordatorio-limites' })
  async recordatorioLimites() {
    try {
      const periodo = periodoActual();
      const enAdvertencia = await this.prisma.usoMensual.findMany({
        where: { periodo, estado: 'ADVERTENCIA' },
        select: { negocioId: true, recurso: true, cantidad: true, limiteBase: true, limiteGracia: true },
      });

      const porNegocio = new Map<string, typeof enAdvertencia>();
      for (const u of enAdvertencia) {
        const lista = porNegocio.get(u.negocioId) ?? [];
        lista.push(u);
        porNegocio.set(u.negocioId, lista);
      }

      let enviados = 0;
      for (const [negocioId, usos] of porNegocio) {
        const detalle = usos
          .map((u) => `${ETIQUETA[RECURSO_A_FEATURE[u.recurso]] ?? u.recurso}: ${u.cantidad}/${u.limiteBase}`)
          .join(', ');
        const dueno = await this.prisma.empleado.findFirst({
          where: { negocioId, rol: 'DUENO', activo: true, eliminadoEn: null },
          select: { id: true },
        });
        if (!dueno) continue;
        const pct = Math.round((usos[0].cantidad / Math.max(1, usos[0].limiteBase)) * 100);
        await this.push.enviarAEmpleado(negocioId, dueno.id, {
          title: `Estas al ${pct}% de tu limite`,
          body: `${detalle}. Mejora a un plan superior para no bloquear tu cuenta.`,
          url: '/plan', tag: 'limite-advertencia',
        }).catch(() => undefined);
        await this.auditoria.registrar({
          negocioId, accion: 'plan.recordatorio_limite',
          detalle: { periodo, recursos: usos.map((u) => u.recurso) },
        });
        enviados++;
      }
      this.logger.log(`Recordatorios de limite enviados: ${enviados}`);
    } catch (e) {
      this.logger.error(`recordatorioLimites fallo: ${(e as Error).message}`);
    }
  }

  /** Domingos 4 AM: reconciliacion desde las tablas reales. */
  @Cron('0 4 * * 0', { name: 'planes-reconciliacion' })
  async reconciliacionSemanal() {
    try {
      const negocios = await this.prisma.negocio.findMany({ where: { activo: true }, select: { id: true } });
      let corregidos = 0;
      for (const n of negocios) {
        const r = await this.uso.sincronizarUsoActual(n.id);
        corregidos += r.corregidos;
      }
      this.logger.log(`Reconciliacion: ${negocios.length} negocio(s), ${corregidos} desfase(s) corregido(s)`);
    } catch (e) {
      this.logger.error(`reconciliacionSemanal fallo: ${(e as Error).message}`);
    }
  }

  /** Dia 1 a las 5 AM: reporte del mes anterior (email queda para el #32). */
  @Cron('0 5 1 * *', { name: 'planes-reporte-mensual' })
  async reporteMensual() {
    try {
      const ahora = new Date();
      const anterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const periodo = periodoActual(anterior);

      const negocios = await this.prisma.negocio.findMany({ where: { activo: true }, select: { id: true, nombre: true } });
      let generados = 0;
      for (const neg of negocios) {
        const usos = await this.prisma.usoMensual.findMany({ where: { negocioId: neg.id, periodo } });
        if (!usos.length) continue;

        const necesitaUpgrade = usos.some((u) => u.estado === 'EXCEDIDO' || u.estado === 'ADVERTENCIA');
        const excedentes = usos.filter((u) => u.excedente > 0).map((u) => ({ recurso: u.recurso, excedente: u.excedente }));

        await this.auditoria.registrar({
          negocioId: neg.id, accion: 'plan.reporte_mensual',
          detalle: {
            periodo,
            uso: usos.map((u) => ({ recurso: u.recurso, cantidad: u.cantidad, limiteBase: u.limiteBase, estado: u.estado })),
            excedentes,
            necesitaUpgrade,
            // Listo para que el #32 (Resend) mande el email:
            asunto: `Tu resumen de ${periodo} en Clubio`,
            cuerpo: usos.map((u) => `${RECURSO_A_FEATURE[u.recurso]}: ${u.cantidad}/${u.limiteBase} (${u.estado})`).join('\n')
              + (necesitaUpgrade ? '\n\nTe conviene pasar a un plan superior.' : ''),
          },
        });
        generados++;
      }
      this.logger.log(`Reportes mensuales generados: ${generados} (periodo ${periodo})`);
    } catch (e) {
      this.logger.error(`reporteMensual fallo: ${(e as Error).message}`);
    }
  }
}