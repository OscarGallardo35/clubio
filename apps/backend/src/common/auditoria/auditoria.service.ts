import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface EventoAuditoriaInput {
  negocioId: string;
  accion: string;              // ej: 'cliente.creado', 'empleado.desactivado'
  empleadoId?: string | null;
  clienteId?: string | null;
  detalle?: unknown;
  ip?: string | null;
}

/**
 * Registra cada CUD en EventoAuditoria.
 * Nunca lanza: si falla la auditoria, no debe romper la operacion de negocio.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger('Auditoria');

  constructor(private readonly prisma: PrismaService) {}

  async registrar(input: EventoAuditoriaInput): Promise<void> {
    try {
      await this.prisma.eventoAuditoria.create({
        data: {
          negocioId: input.negocioId,
          accion: input.accion,
          empleadoId: input.empleadoId ?? null,
          clienteId: input.clienteId ?? null,
          detalle: (input.detalle ?? undefined) as never,
          ip: input.ip ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`No se pudo auditar "${input.accion}": ${(e as Error).message}`);
    }
  }

  /** Listado paginado de eventos (para la PWA Admin). */
  async listar(negocioId: string, page: number, pageSize: number, accion?: string) {
    const where = { negocioId, ...(accion ? { accion } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.eventoAuditoria.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.eventoAuditoria.count({ where }),
    ]);
    return { data, total };
  }
}
