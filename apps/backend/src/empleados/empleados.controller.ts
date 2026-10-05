import {
  Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { EmpleadosService } from './empleados.service';
import type { AuthCtxEmp } from './empleados.service';
import { CrearEmpleadoDto } from './dto/crear-empleado.dto';
import { ActualizarEmpleadoDto, ResetPinDto } from './dto/actualizar-empleado.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';

interface EmpAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

@Controller('empleados')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class EmpleadosController {
  constructor(private readonly empleados: EmpleadosService) {}

  private ctx(emp: EmpAuth, ip: string): AuthCtxEmp {
    return { empleadoId: emp.id, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get()
  listar(
    @CurrentEmpleado() emp: EmpAuth,
    @Query() q: { page?: string; pageSize?: string; sucursalId?: string; rol?: RolEmpleado },
  ) {
    return this.empleados.listar(emp.negocioId, q, this.ctx(emp, ''));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get(':id')
  obtener(@CurrentEmpleado() emp: EmpAuth, @Param('id') id: string) {
    return this.empleados.obtener(emp.negocioId, id);
  }

  @Roles(RolEmpleado.DUENO)
  @Post()
  crear(@CurrentEmpleado() emp: EmpAuth, @Body() dto: CrearEmpleadoDto, @Ip() ip: string) {
    return this.empleados.crear(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO)
  @Patch(':id')
  actualizar(
    @CurrentEmpleado() emp: EmpAuth, @Param('id') id: string,
    @Body() dto: ActualizarEmpleadoDto, @Ip() ip: string,
  ) {
    return this.empleados.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO)
  @Patch(':id/reset-pin')
  resetPin(
    @CurrentEmpleado() emp: EmpAuth, @Param('id') id: string,
    @Body() dto: ResetPinDto, @Ip() ip: string,
  ) {
    return this.empleados.resetPin(emp.negocioId, id, dto.pin, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO)
  @Delete(':id')
  desactivar(@CurrentEmpleado() emp: EmpAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.empleados.desactivar(emp.negocioId, id, this.ctx(emp, ip));
  }
}
