import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { EstadisticasService } from './estadisticas.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('estadisticas')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class EstadisticasController {
  constructor(private readonly estadisticas: EstadisticasService) {}

  /** KPIs del dia + comparacion con ayer (cache 5 min). */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('dashboard')
  dashboard(@CurrentEmpleado() emp: EmpleadoAuth, @Query('sucursalId') sucursalId?: string) {
    return this.estadisticas.dashboard(emp.negocioId, { sucursalId: sucursalId ?? null });
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('top-clientes')
  topClientes(@CurrentEmpleado() emp: EmpleadoAuth, @Query('limite') limite?: string) {
    return this.estadisticas.topClientes(emp.negocioId, limite ? Number(limite) : 10);
  }
}