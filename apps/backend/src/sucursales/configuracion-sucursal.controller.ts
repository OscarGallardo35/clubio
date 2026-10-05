import { Body, Controller, Delete, Get, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ConfiguracionSucursalService } from './configuracion-sucursal.service';
import { ActualizarConfiguracionSucursalDto } from './dto/actualizar-configuracion-sucursal.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('sucursales/:sucursalId/configuracion')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class ConfiguracionSucursalController {
  constructor(private readonly cfg: ConfiguracionSucursalService) {}

  /** Override crudo (con nulls). */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get()
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string) {
    return this.cfg.obtenerOverride(emp.negocioId, sucursalId);
  }

  /** Resuelta: delega en configEfectiva. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('efectiva')
  efectiva(@CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string) {
    return this.cfg.obtenerEfectiva(emp.negocioId, sucursalId);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('campos')
  campos() {
    return { data: this.cfg.camposOverrideables() };
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post()
  crearOActualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string,
    @Body() dto: ActualizarConfiguracionSucursalDto, @Ip() ip: string,
  ) {
    return this.cfg.crearOActualizar(emp.negocioId, sucursalId, dto, { empleadoId: emp.id, ip });
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Delete()
  eliminar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string, @Ip() ip: string) {
    return this.cfg.eliminarOverride(emp.negocioId, sucursalId, { empleadoId: emp.id, ip });
  }
}