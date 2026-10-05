import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, RolEmpleado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { getPagination, paginar } from '../common/utils/pagination.util';
import type { CrearEmpleadoDto } from './dto/crear-empleado.dto';
import type { ActualizarEmpleadoDto } from './dto/actualizar-empleado.dto';

export interface AuthCtxEmp {
  empleadoId: string;
  rol: string;
  sucursalId?: string;
  ip?: string;
}

const SELECT_PUBLICO = {
  id: true, negocioId: true, sucursalId: true, nombre: true, rol: true,
  email: true, telefono: true, avatarUrl: true, twoFactorEnabled: true,
  accesoMultiSucursal: true, activo: true, ultimoAcceso: true, creadoEn: true,
} as const;

const ROLES_PRIVILEGIADOS = ['DUENO', 'ENCARGADO'];

@Injectable()
export class EmpleadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(negocioId: string, q: { page?: string; pageSize?: string; sucursalId?: string; rol?: RolEmpleado }, ctx: AuthCtxEmp) {
    const { page, pageSize, skip, take } = getPagination(q);
    const where: Prisma.EmpleadoWhereInput = { negocioId, eliminadoEn: null };

    if (q.rol) where.rol = q.rol;

    const esPrivilegiado = ROLES_PRIVILEGIADOS.includes(ctx.rol);
    // Refinamiento 5: el empleado comun solo ve su propia sucursal
    const sucursalFiltro = esPrivilegiado ? q.sucursalId : ctx.sucursalId;
    if (sucursalFiltro) where.sucursalId = sucursalFiltro;

    const [data, total] = await Promise.all([
      this.prisma.empleado.findMany({
        where, orderBy: [{ rol: 'asc' }, { nombre: 'asc' }], skip, take,
        select: { ...SELECT_PUBLICO, sucursal: { select: { id: true, nombre: true, slug: true } } },
      }),
      this.prisma.empleado.count({ where }),
    ]);
    return paginar(data, total, page, pageSize);
  }

  async obtener(negocioId: string, id: string) {
    const empleado = await this.prisma.empleado.findFirst({
      where: { id, negocioId, eliminadoEn: null },
      select: { ...SELECT_PUBLICO, sucursal: { select: { id: true, nombre: true, slug: true } } },
    });
    if (!empleado) throw new NotFoundException('Empleado no encontrado');
    return empleado;
  }

  async crear(negocioId: string, dto: CrearEmpleadoDto, ctx: AuthCtxEmp) {
    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id: dto.sucursalId, negocioId }, select: { id: true },
    });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada en este negocio');

    if (dto.email) {
      const dup = await this.prisma.empleado.findFirst({
        where: { negocioId, email: dto.email.toLowerCase(), eliminadoEn: null }, select: { id: true },
      });
      if (dup) throw new ConflictException('Ya existe un empleado con ese email');
    }

    const data: Prisma.EmpleadoCreateInput = {
      negocio: { connect: { id: negocioId } },
      sucursal: { connect: { id: sucursal.id } },
      nombre: dto.nombre,
      rol: dto.rol,
      email: dto.email ? dto.email.toLowerCase() : null,
      telefono: dto.telefono ?? null,
      accesoMultiSucursal: dto.accesoMultiSucursal ?? false,
      // PIN hasheado con bcrypt (nunca en claro)
      pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
      passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : null,
      twoFactorEnabled: dto.rol === RolEmpleado.DUENO ? false : false,
    };

    const empleado = await this.prisma.empleado.create({ data, select: SELECT_PUBLICO });
    await this.auditoria.registrar({
      negocioId, accion: 'empleado.creado', empleadoId: ctx.empleadoId,
      detalle: { empleadoCreadoId: empleado.id, rol: empleado.rol, sucursalId: empleado.sucursalId }, ip: ctx.ip,
    });
    return empleado;
  }

  async actualizar(negocioId: string, id: string, dto: ActualizarEmpleadoDto, ctx: AuthCtxEmp) {
    await this.obtener(negocioId, id);
    const empleado = await this.prisma.empleado.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.rol !== undefined ? { rol: dto.rol } : {}),
        ...(dto.sucursalId !== undefined ? { sucursalId: dto.sucursalId } : {}),
        ...(dto.email !== undefined ? { email: dto.email ? dto.email.toLowerCase() : null } : {}),
        ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
        ...(dto.accesoMultiSucursal !== undefined ? { accesoMultiSucursal: dto.accesoMultiSucursal } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
      select: SELECT_PUBLICO,
    });
    await this.auditoria.registrar({
      negocioId, accion: 'empleado.actualizado', empleadoId: ctx.empleadoId,
      detalle: { empleadoId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return empleado;
  }

  /** Soft delete (Empleado SI tiene eliminadoEn en el schema). */
  async desactivar(negocioId: string, id: string, ctx: AuthCtxEmp) {
    await this.obtener(negocioId, id);
    const empleado = await this.prisma.empleado.update({
      where: { id },
      data: { activo: false, eliminadoEn: new Date() },
      select: { id: true, nombre: true, activo: true, eliminadoEn: true },
    });
    await this.prisma.sesionEmpleado.deleteMany({ where: { empleadoId: id } });
    await this.prisma.sesionDueno.deleteMany({ where: { empleadoId: id } });
    await this.auditoria.registrar({
      negocioId, accion: 'empleado.desactivado', empleadoId: ctx.empleadoId,
      detalle: { empleadoId: id }, ip: ctx.ip,
    });
    return empleado;
  }

  async resetPin(negocioId: string, id: string, pin: string, ctx: AuthCtxEmp) {
    await this.obtener(negocioId, id);
    await this.prisma.empleado.update({
      where: { id },
      data: { pinHash: await bcrypt.hash(pin, 10) },
    });
    await this.auditoria.registrar({
      negocioId, accion: 'empleado.pin_reseteado', empleadoId: ctx.empleadoId,
      detalle: { empleadoId: id }, ip: ctx.ip,
    });
    return { ok: true };
  }
}
