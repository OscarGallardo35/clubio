import {
  Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ClientesService } from './clientes.service';
import type { AuthCtx } from './clientes.service';
import { CrearClienteManualDto } from './dto/crear-cliente-manual.dto';
import { ActualizarClienteDto } from './dto/actualizar-cliente.dto';
import { FiltrarClientesDto } from './dto/filtrar-clientes.dto';
import { RegalarSelloDto } from './dto/regalar-sello.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';
import { TenantGuard } from '../common/guards/tenant.guard';
import { getPagination } from '../common/utils/pagination.util';

interface EmpleadoAuth {
  id: string; negocioId: string; rol: RolEmpleado; sucursalId: string;
}

@Controller('clientes')
@UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  private ctx(emp: EmpleadoAuth, ip: string): AuthCtx {
    return { empleadoId: emp.id, negocioId: emp.negocioId, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  // Lectura abierta a staff: el servicio filtra por sucursal a los no privilegiados.
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @RequiereFeature('crm')
  @Get()
  listar(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarClientesDto) {
    return this.clientes.listar(emp.negocioId, filtros, this.ctx(emp, ''));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Get(':id')
  obtener(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Query() q: { page?: string; pageSize?: string },
  ) {
    const { page, pageSize } = getPagination(q);
    return this.clientes.obtener(emp.negocioId, id, page, pageSize, emp.rol);
  }

  /** Historial detallado: solo admin (el staff no ve el historial). */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get(':id/visitas')
  visitas(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Query() q: { page?: string; pageSize?: string },
  ) {
    const { page, pageSize } = getPagination(q);
    return this.clientes.visitas(emp.negocioId, id, page, pageSize);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post()
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearClienteManualDto, @Ip() ip: string) {
    return this.clientes.crearManual(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('crm')
  @Patch(':id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: ActualizarClienteDto,
    @Ip() ip: string,
  ) {
    return this.clientes.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  /** Refinamiento 5: solo DUENO puede eliminar. */
  @Roles(RolEmpleado.DUENO)
  @Delete(':id')
  eliminar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.clientes.eliminar(emp.negocioId, id, this.ctx(emp, ip));
  }

  /** Refinamiento 5: solo DUENO regala sellos. */
  @Roles(RolEmpleado.DUENO)
  @Post(':id/regalar-sello')
  regalar(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: RegalarSelloDto,
    @Ip() ip: string,
  ) {
    return this.clientes.regalarSello(emp.negocioId, id, dto, this.ctx(emp, ip));
  }
}
