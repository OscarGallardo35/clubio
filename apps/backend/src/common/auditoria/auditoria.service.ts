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
export interface EventoSuperAdminInput {
  superAdminId: string;        // OBLIGATORIO (FK a SuperAdmin)
  accion: string;
  negocioId?: string | null;   // nullable: hay acciones que no son de un negocio
  detalle?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

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

  /**
   * Auditoria de PLATAFORMA (acciones del super-admin).
   *
   * Va a EventoAuditoriaSuperAdmin y no a EventoAuditoria: esta ultima tiene
   * `negocioId` OBLIGATORIO, asi que un cambio de plan (que no pertenece a ningun
   * negocio) no se puede registrar ahi. Mismo criterio: nunca lanza.
   */
  async registrarSuperAdmin(input: EventoSuperAdminInput): Promise<void> {
    try {
      await this.prisma.eventoAuditoriaSuperAdmin.create({
        data: {
          superAdminId: input.superAdminId,
          negocioId: input.negocioId ?? null,
          accion: input.accion,
          detalle: (input.detalle ?? undefined) as never,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`No se pudo auditar (super-admin) "${input.accion}": ${(e as Error).message}`);
    }
  }
}
