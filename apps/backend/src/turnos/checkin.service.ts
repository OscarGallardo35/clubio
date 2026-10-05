
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { enTurnoAhora, fechaSoloDia, hoy } from './helpers/horarios';
import type { CheckinDto } from './dto/checkin.dto';

export interface CtxCheckin {
  empleadoId: string;
  negocioId: string;
  sucursalId?: string | null;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Turno del empleado que cubre AHORA (soporta franjas que cruzan medianoche). */
  async turnoActual(negocioId: string, empleadoId: string, ahora = new Date()) {
    const fechaHoy = fechaSoloDia(hoy());
    const ayer = new Date(fechaHoy);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;

    // Se miran tambien los turnos de AYER: uno que cruza medianoche (22:00-02:00)
    // sigue vigente a las 01:00 del dia siguiente.
    const turnos = await this.prisma.turno.findMany({
      where: { negocioId, empleadoId, fecha: { in: [fechaHoy, ayer] } },
      orderBy: { horaInicio: 'asc' },
    });
    return turnos.find((t) => enTurnoAhora(t.horaInicio, t.horaFin, hora)) ?? null;
  }

  /** Check-in idempotente: si ya hay uno abierto, 409 (no duplica fila). */
  async checkin(ctx: CtxCheckin, dto: CheckinDto) {
    const abierto = await this.prisma.checkinTurno.findFirst({
      where: { negocioId: ctx.negocioId, empleadoId: ctx.empleadoId, checkoutEn: null },
      select: { id: true, checkinEn: true },
    });
    if (abierto) {
      throw new ConflictException(
        `Ya tenes un check-in abierto desde ${abierto.checkinEn.toISOString()}`,
      );
    }

    const turno = await this.turnoActual(ctx.negocioId, ctx.empleadoId);
    if (!turno) {
      throw new BadRequestException('No tenes un turno vigente ahora');
    }

    const checkin = await this.prisma.checkinTurno.create({
      data: {
        negocioId: ctx.negocioId, sucursalId: turno.sucursalId, empleadoId: ctx.empleadoId,
        turnoId: turno.id, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null,
        notas: dto.notas ?? dto.origen ?? null,
      },
    });

    await this.auditoria.registrar({
      negocioId: ctx.negocioId, accion: 'turno.checkin', empleadoId: ctx.empleadoId,
      detalle: { checkinId: checkin.id, turnoId: turno.id, sucursalId: turno.sucursalId },
      ip: ctx.ip,
    });
    return checkin;
  }

  /** Check-out: cierra el check-in abierto. Si no hay, 404. */
  async checkout(ctx: CtxCheckin) {
    const abierto = await this.prisma.checkinTurno.findFirst({
      where: { negocioId: ctx.negocioId, empleadoId: ctx.empleadoId, checkoutEn: null },
      select: { id: true },
    });
    if (!abierto) throw new NotFoundException('No tenes un check-in abierto');

    const cerrado = await this.prisma.checkinTurno.update({
      where: { id: abierto.id },
      data: { checkoutEn: new Date() },
    });

    await this.auditoria.registrar({
      negocioId: ctx.negocioId, accion: 'turno.checkout', empleadoId: ctx.empleadoId,
      detalle: { checkinId: abierto.id }, ip: ctx.ip,
    });
    return cerrado;
  }

  async estado(negocioId: string, empleadoId: string) {
    const [abierto, turno] = await Promise.all([
      this.prisma.checkinTurno.findFirst({
        where: { negocioId, empleadoId, checkoutEn: null },
        select: { id: true, checkinEn: true },
      }),
      this.turnoActual(negocioId, empleadoId),
    ]);
    return {
      enTurno: !!turno,
      turno: turno ? { id: turno.id, horaInicio: turno.horaInicio, horaFin: turno.horaFin, tipoTurno: turno.tipoTurno } : null,
      checkinAbierto: abierto,
    };
  }

  /** Listado para el admin: quienes estan en el local ahora. */
  async presentes(negocioId: string, sucursalId?: string | null) {
    const data = await this.prisma.checkinTurno.findMany({
      where: { negocioId, checkoutEn: null, ...(sucursalId ? { sucursalId } : {}) },
      orderBy: { checkinEn: 'asc' },
      include: {
        empleado: { select: { id: true, nombre: true, rol: true } },
        sucursal: { select: { id: true, nombre: true, slug: true } },
      },
    });
    return { data, total: data.length };
  }

  /** IDs de los empleados con check-in abierto (lo usa el motor de asignacion). */
  async empleadosConCheckin(negocioId: string, sucursalId: string) {
    const filas = await this.prisma.checkinTurno.findMany({
      where: { negocioId, sucursalId, checkoutEn: null },
      select: { empleadoId: true },
      distinct: ['empleadoId'],
    });
    return filas.map((f) => f.empleadoId);
  }

  /** Cron 23:59: cierra los check-ins huerfanos (nadie se acordo de salir). */
  async cerrarHuerfanos() {
    const r = await this.prisma.checkinTurno.updateMany({
      where: { checkoutEn: null, checkinEn: { lt: new Date(Date.now() - 12 * 3_600_000) } },
      data: { checkoutEn: new Date() },
    });
    return { cerrados: r.count };
  }
}
