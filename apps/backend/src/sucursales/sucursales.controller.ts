import {
  BadRequestException, Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { SucursalesService } from './sucursales.service';
import type { CtxSucursal } from './sucursales.service';
import { CrearSucursalDto } from './dto/crear-sucursal.dto';
import { ActualizarSucursalDto, EliminarSucursalDto } from './dto/actualizar-sucursal.dto';
import { FiltrarSucursalesDto } from './dto/filtrar-sucursales.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth {
  id: string; negocioId: string; rol: RolEmpleado;
  sucursalId: string; accesoMultiSucursal?: boolean;
}

const TODOS = [RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY];

@Controller('sucursales')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  private ctx(emp: EmpleadoAuth, ip: string): CtxSucursal {
    return {
      empleadoId: emp.id, rol: emp.rol, sucursalId: emp.sucursalId,
      accesoMultiSucursal: emp.accesoMultiSucursal, ip,
    };
  }

  // ---- rutas literales ANTES de ':id' ----

  /** Consumido por la PWA Staff (#4.7). Alcance segun el rol. */
  @Roles(...TODOS)
  @Get('mis-sucursales')
  misSucursales(@CurrentEmpleado() emp: EmpleadoAuth, @Ip() ip: string) {
    return this.sucursales.misSucursales(emp.negocioId, this.ctx(emp, ip));
  }

  /**
   * Publico (PWA Cliente): solo las activas, sin metricas ni datos internos.
   * No pasa por StaffGuard: el negocio sale del tenant (X-Tenant-Slug/subdominio).
   */
  @Get('publico')
  @UseGuards(TenantGuard)
  publico(@Req() req: { tenant?: string }) {
    if (!req.tenant) throw new BadRequestException('Falta el tenant (X-Tenant-Slug o subdominio)');
    return this.sucursales.listarPublicoPorSlug(req.tenant);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get()
  listar(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarSucursalesDto) {
    return this.sucursales.listar(emp.negocioId, filtros);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post()
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearSucursalDto, @Ip() ip: string) {
    return this.sucursales.crear(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get(':id')
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.sucursales.obtenerPorId(emp.negocioId, id);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Patch(':id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ActualizarSucursalDto, @Ip() ip: string,
  ) {
    return this.sucursales.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO)
  @Patch(':id/principal')
  marcarPrincipal(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.sucursales.marcarPrincipal(emp.negocioId, id, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO)
  @Delete(':id')
  eliminar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Query() q: EliminarSucursalDto, @Ip() ip: string,
  ) {
    return this.sucursales.eliminar(emp.negocioId, id, this.ctx(emp, ip), q.force === true);
  }
}