
import { Injectable, Logger } from '@nestjs/common';
import { TipoTurno } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { CheckinService } from './checkin.service';
import { enTurnoAhora, fechaSoloDia, hoy } from './helpers/horarios';
import type { Destinatarios, EmpleadoEnTurno } from './interfaces/empleado-en-turno.interface';

/** tipoTurno que puede atender cada tipo de pedido. */
export const COMPATIBILIDAD: Record<string, TipoTurno[]> = {
  MESA: ['MESERO', 'ENCARGADO', 'EMPLEADO'] as TipoTurno[],
  TAKEAWAY: ['CAJERO', 'ENCARGADO', 'EMPLEADO'] as TipoTurno[],
  DELIVERY: ['DELIVERY', 'ENCARGADO', 'EMPLEADO'] as TipoTurno[],
};

/** El tipo "especifico" de cada pedido (para POR_ROL). */
export const ROL_ESPECIFICO: Record<string, TipoTurno> = {
  MESA: 'MESERO' as TipoTurno,
  TAKEAWAY: 'CAJERO' as TipoTurno,
  DELIVERY: 'DELIVERY' as TipoTurno,
};

/**
 * Motor de asignacion de pedidos.
 *
 * IMPORTANTE: este servicio SOLO CALCULA. No emite WebSocket ni push ni conoce
 * el gateway. Eso lo hace pedidos.service, que ya tiene el gateway. Gracias a
 * eso TurnosModule no necesita importar PedidosModule y no hay dependencia
 * circular (evitamos forwardRef).
 */
@Injectable()
export class AsignacionPedidosService {
  private readonly logger = new Logger('AsignacionPedidos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkin: CheckinService,
    private readonly resolver: SucursalResolverService,
  ) {}

  /** Empleados con turno vigente AHORA en una sucursal (incluye los de ayer por medianoche). */
  async obtenerEmpleadosEnTurno(negocioId: string, sucursalId: string, ahora = new Date()): Promise<EmpleadoEnTurno[]> {
    const hoyFecha = fechaSoloDia(hoy());
    const ayer = new Date(hoyFecha);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;

    const turnos = await this.prisma.turno.findMany({
      where: { negocioId, sucursalId, fecha: { in: [hoyFecha, ayer] } },
      orderBy: { horaInicio: 'asc' },
      include: { empleado: { select: { id: true, nombre: true, rol: true, activo: true, eliminadoEn: true } } },
    });

    const conCheckin = new Set(await this.checkin.empleadosConCheckin(negocioId, sucursalId));

    return turnos
      .filter((t) => t.empleado.activo && !t.empleado.eliminadoEn)
      .filter((t) => enTurnoAhora(t.horaInicio, t.horaFin, hora))
      .map((t) => ({
        empleadoId: t.empleadoId,
        nombre: t.empleado.nombre,
        rol: t.empleado.rol,
        tipoTurno: t.tipoTurno,
        sucursalId: t.sucursalId,
        horaInicio: t.horaInicio,
        horaFin: t.horaFin,
        turnoId: t.id,
        hizoCheckin: conCheckin.has(t.empleadoId),
      }));
  }

  /** Empleados activos de la sucursal (fallback cuando no hay turnos). */
  private async activosDeSucursal(negocioId: string, sucursalId: string, tipoPedido: string) {
    const empleados = await this.prisma.empleado.findMany({
      where: { negocioId, activo: true, eliminadoEn: null },
      select: { id: true, nombre: true, rol: true, sucursalId: true, accesoMultiSucursal: true },
    });
    // De la sucursal, o multi-sucursal del mismo negocio
    const compatibles = empleados.filter((e) => e.sucursalId === sucursalId || e.accesoMultiSucursal);
    const rolesPedido = COMPATIBILIDAD[tipoPedido] ?? [];
    // Los roles de pedido son TipoTurno, que no son 1:1 con RolEmpleado: se acepta
    // a cualquiera activo (el filtro fino es por tipoTurno cuando hay turnos).
    void rolesPedido;
    return compatibles;
  }

  async encargadoDelDia(negocioId: string, sucursalId: string, fecha = hoy()) {
    const guardado = await this.prisma.encargadoDia.findUnique({
      where: { negocioId_sucursalId_fecha: { negocioId, sucursalId, fecha: fechaSoloDia(fecha) } },
      select: { empleadoId: true },
    });
    if (guardado) return guardado.empleadoId;

    // Fallback: primer turno ENCARGADO de hoy
    const turno = await this.prisma.turno.findFirst({
      where: { negocioId, sucursalId, fecha: fechaSoloDia(fecha), tipoTurno: 'ENCARGADO' },
      orderBy: { horaInicio: 'asc' },
      select: { empleadoId: true },
    });
    return turno?.empleadoId ?? null;
  }

  /**
   * Calcula a QUIENES notificar y si hay un empleado asignado de antemano.
   * `pedido` solo necesita sucursalId y tipo.
   */
  async determinarDestinatarios(
    negocioId: string,
    pedido: { sucursalId: string; tipo: string },
  ): Promise<Destinatarios & { numeroAtendiente: string | null }> {
    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: {
        modoAsignacionPedidos: true, turnosActivos: true,
        checkinObligatorio: true,
      },
    });
    // #2.11: el numero de atencion se resuelve sucursal -> club -> null (antes se
    // leia SOLO el del club, asi que una sucursal con su propio numero lo ignoraba).
    const numeroAtendiente = await this.resolver.resolverNumeroAtendiente(negocioId, pedido.sucursalId);
    const modo = config?.modoAsignacionPedidos ?? 'BROADCAST';
    const encargadoId = await this.encargadoDelDia(negocioId, pedido.sucursalId);

    // ---- turnosActivos = false: todos los activos de la sucursal ----
    if (!config?.turnosActivos) {
      const activos = await this.activosDeSucursal(negocioId, pedido.sucursalId, pedido.tipo);
      return {
        empleadosNotificados: activos.map((e) => e.id),
        empleadoAsignado: null,
        encargadoId,
        modoEfectivo: 'BROADCAST',
        motivo: 'turnosActivos=false (todos los activos de la sucursal)',
        numeroAtendiente,
      };
    }

    // ---- turnosActivos = true ----
    const enTurno = await this.obtenerEmpleadosEnTurno(negocioId, pedido.sucursalId);

    if (!enTurno.length) {
      const activos = await this.activosDeSucursal(negocioId, pedido.sucursalId, pedido.tipo);
      return {
        empleadosNotificados: activos.map((e) => e.id),
        empleadoAsignado: null,
        encargadoId,
        modoEfectivo: 'BROADCAST',
        motivo: 'nadie en turno ahora (fallback a activos de la sucursal)',
        numeroAtendiente,
      };
    }

    // Filtro por tipo de pedido
    const permitidos = COMPATIBILIDAD[pedido.tipo] ?? [];
    const compatibles = enTurno.filter((e) => permitidos.includes(e.tipoTurno));
    const base = compatibles.length ? compatibles : enTurno;

    // checkinObligatorio: solo los que hicieron check-in
    let candidatos = base;
    let motivoCheckin = '';
    if (config.checkinObligatorio) {
      const conCheckin = base.filter((e) => e.hizoCheckin);
      if (conCheckin.length) {
        candidatos = conCheckin;
        motivoCheckin = 'checkinObligatorio=true, solo con check-in';
      } else {
        // Fallback: no dejar el pedido sin avisar
        candidatos = base;
        motivoCheckin = 'checkinObligatorio=true pero NADIE hizo check-in (fallback a programados)';
      }
    }

    // Modo de asignacion
    if (modo === 'POR_ROL') {
      const rol = ROL_ESPECIFICO[pedido.tipo];
      const delRol = candidatos.filter((e) => e.tipoTurno === rol);
      if (delRol.length) {
        return {
          empleadosNotificados: [delRol[0].empleadoId],
          empleadoAsignado: delRol[0].empleadoId,
          encargadoId,
          modoEfectivo: 'POR_ROL',
          motivo: `POR_ROL: ${delRol[0].nombre} (${rol})${motivoCheckin ? ' | ' + motivoCheckin : ''}`,
          numeroAtendiente,
        };
      }
      this.logger.warn(`POR_ROL sin ${rol} en turno; se cae a BROADCAST`);
      return {
        empleadosNotificados: candidatos.map((e) => e.empleadoId),
        empleadoAsignado: null,
        encargadoId,
        modoEfectivo: 'BROADCAST',
        motivo: `POR_ROL sin ${rol} en turno -> fallback BROADCAST${motivoCheckin ? ' | ' + motivoCheckin : ''}`,
        numeroAtendiente,
      };
    }

    if (modo === 'SOLO_ENCARGADO') {
      if (encargadoId && candidatos.some((e) => e.empleadoId === encargadoId)) {
        return {
          empleadosNotificados: [encargadoId],
          empleadoAsignado: encargadoId,
          encargadoId,
          modoEfectivo: 'SOLO_ENCARGADO',
          motivo: `SOLO_ENCARGADO: ${encargadoId}${motivoCheckin ? ' | ' + motivoCheckin : ''}`,
          numeroAtendiente,
        };
      }
      this.logger.warn('SOLO_ENCARGADO sin encargado en turno; se cae a BROADCAST');
      return {
        empleadosNotificados: candidatos.map((e) => e.empleadoId),
        empleadoAsignado: null,
        encargadoId,
        modoEfectivo: 'BROADCAST',
        motivo: `SOLO_ENCARGADO sin encargado en turno -> fallback BROADCAST${motivoCheckin ? ' | ' + motivoCheckin : ''}`,
        numeroAtendiente,
      };
    }

    // BROADCAST
    return {
      empleadosNotificados: candidatos.map((e) => e.empleadoId),
      empleadoAsignado: null,
      encargadoId,
      modoEfectivo: 'BROADCAST',
      motivo: `BROADCAST a ${candidatos.length} empleado(s) en turno${motivoCheckin ? ' | ' + motivoCheckin : ''}`,
      numeroAtendiente,
    };
  }
}
