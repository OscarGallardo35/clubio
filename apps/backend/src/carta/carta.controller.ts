import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { CartaService } from './carta.service';
import type { CartaCtx } from './carta.service';
import { CrearItemCartaDto } from './dto/crear-item-carta.dto';
import { ActualizarItemCartaDto, DisponibilidadItemDto } from './dto/actualizar-item-carta.dto';
import { ReordenarCartaDto } from './dto/reordenar-carta.dto';
import { FiltrarCartaDto } from './dto/filtrar-carta.dto';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

@Controller('carta')
export class CartaController {
  constructor(private readonly carta: CartaService) {}

  private ctx(emp: EmpleadoAuth, ip: string): CartaCtx {
    return { empleadoId: emp.id, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  /** QR #1: carta publica. Requiere el tenant por header/slug, sin login. */
  @Public()
  @UseGuards(TenantGuard)
  @Get()
  publica(@Tenant() tenant: string | null, @Query() filtros: FiltrarCartaDto) {
    return this.carta.listarPublico(tenant as string, filtros);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('admin')
  admin(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarCartaDto) {
    return this.carta.listarAdmin(emp.negocioId, filtros);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('menu')
  @Post()
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearItemCartaDto, @Ip() ip: string) {
    return this.carta.crear(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('reordenar')
  reordenar(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: ReordenarCartaDto, @Ip() ip: string) {
    return this.carta.reordenar(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('menu')
  @Patch(':id/disponibilidad')
  disponibilidad(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: DisponibilidadItemDto, @Ip() ip: string,
  ) {
    return this.carta.toggleDisponibilidad(emp.negocioId, id, dto.disponible, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('menu')
  @Patch(':id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ActualizarItemCartaDto, @Ip() ip: string,
  ) {
    return this.carta.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('menu')
  @Delete(':id')
  eliminar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.carta.eliminar(emp.negocioId, id, this.ctx(emp, ip));
  }
}
