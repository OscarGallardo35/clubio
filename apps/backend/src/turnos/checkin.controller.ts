import { Body, Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { CheckinService } from './checkin.service';
import type { CtxCheckin } from './checkin.service';
import { CheckinDto } from './dto/checkin.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

const LECTURA = [RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY];

@Controller('checkin')
@UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  private ctx(emp: EmpleadoAuth, ip: string, ua?: string): CtxCheckin {
    return { empleadoId: emp.id, negocioId: emp.negocioId, sucursalId: emp.sucursalId, ip, userAgent: ua };
  }

  @Roles(...LECTURA)
  @RequiereFeature('checkin')
  @Get('estado')
  estado(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.checkin.estado(emp.negocioId, emp.id);
  }

  @Roles(...LECTURA)
  @RequiereFeature('checkin')
  @Post()
  entrar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CheckinDto,
    @Ip() ip: string, @Headers('user-agent') ua?: string,
  ) {
    return this.checkin.checkin(this.ctx(emp, ip, ua), dto);
  }

  @Roles(...LECTURA)
  @RequiereFeature('checkin')
  @Post('salir')
  salir(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Ip() ip: string, @Headers('user-agent') ua?: string,
  ) {
    return this.checkin.checkout(this.ctx(emp, ip, ua));
  }
}