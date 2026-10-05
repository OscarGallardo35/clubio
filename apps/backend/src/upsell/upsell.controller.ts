import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolEmpleado } from '@prisma/client';
import { UpsellService } from './upsell.service';
import { MotorUpsellService } from './motor-upsell.service';
import type { CtxUpsell } from './upsell.service';
import { CrearReglaDto } from './dto/crear-regla.dto';
import { ActualizarReglaDto } from './dto/actualizar-regla.dto';
import { CalcularUpsellDto } from './dto/calcular-upsell.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

const LECTURA = [RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY];

@Controller('upsell')
export class UpsellController {
  constructor(
    private readonly upsell: UpsellService,
    private readonly motor: MotorUpsellService,
  ) {}

  private ctx(emp: EmpleadoAuth, ip: string): CtxUpsell {
    return { empleadoId: emp.id, ip };
  }

  /**
   * Publico: lo llama la PWA Cliente en cada cambio del carrito.
   * 60/min por IP (refinamiento 3) para evitar abuso.
   */
  @Public()
  @UseGuards(TenantGuard, PlanGuard)
  @Throttle({
    default: {
      limit: Number(process.env.RATE_UPSELL_LIMIT ?? 60),
      ttl: Number(process.env.RATE_UPSELL_TTL_MS ?? 60_000),
    },
  })
  @RequiereFeature('upsell')
  @Post('calcular')
  async calcular(@Tenant() tenant: string | null, @Body() dto: CalcularUpsellDto) {
    const negocioId = await this.upsell.negocioPorSlug(tenant);
    return this.motor.calcular(negocioId, dto);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(...LECTURA)
  @Get('reglas')
  listar(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.upsell.listar(emp.negocioId);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('upsell')
  @Post('reglas')
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearReglaDto, @Ip() ip: string) {
    return this.upsell.crear(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(...LECTURA)
  @Get('reglas/:id')
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.upsell.obtener(emp.negocioId, id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('upsell')
  @Patch('reglas/:id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ActualizarReglaDto, @Ip() ip: string,
  ) {
    return this.upsell.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('upsell')
  @Delete('reglas/:id')
  eliminar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.upsell.eliminar(emp.negocioId, id, this.ctx(emp, ip));
  }
}