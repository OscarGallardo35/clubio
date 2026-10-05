import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { PlanService } from './plan.service';
import { LimitesService } from './limites.service';
import { UsoMensualService } from './uso-mensual.service';
import { HistoricoUsoDto } from './dto/verificar-limite.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

@Controller('planes')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class PlanesController {
  constructor(
    private readonly plan: PlanService,
    private readonly limites: LimitesService,
    private readonly uso: UsoMensualService,
  ) {}

  /** Plan, features y limites con el uso actual. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('mi-plan')
  miPlan(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.limites.resumenPlan(emp.negocioId);
  }

  /** Detalle del periodo (actual o el que se pida). */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('uso-mensual')
  usoMensual(@CurrentEmpleado() emp: EmpleadoAuth, @Query('periodo') periodo?: string) {
    return this.limites.detalleUso(emp.negocioId, periodo);
  }

  /** Los ultimos N periodos, para el grafico de la PWA Admin. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('uso-mensual/historico')
  historico(@CurrentEmpleado() emp: EmpleadoAuth, @Query() dto: HistoricoUsoDto) {
    return this.uso.historico(emp.negocioId, dto.meses ?? 6);
  }

  /** Catalogo de features de los 3 planes. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('features')
  features() {
    return this.plan.obtenerTodasLasFeatures();
  }
}