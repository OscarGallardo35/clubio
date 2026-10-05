import { Body, Controller, Delete, Get, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ItemCartaSucursalService } from './item-carta-sucursal.service';
import { BulkOverrideItemCartaDto, OverrideItemCartaDto } from './dto/override-item-carta.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('sucursales/:sucursalId/items-override')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class ItemCartaSucursalController {
  constructor(private readonly items: ItemCartaSucursalService) {}

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get()
  listar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string) {
    return this.items.listar(emp.negocioId, sucursalId);
  }

  /** Ruta literal ANTES de ':itemCartaId'. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('bulk')
  bulk(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string,
    @Body() dto: BulkOverrideItemCartaDto, @Ip() ip: string,
  ) {
    return this.items.bulk(emp.negocioId, sucursalId, dto, { empleadoId: emp.id, ip });
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post()
  crearOActualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string,
    @Body() dto: OverrideItemCartaDto, @Ip() ip: string,
  ) {
    return this.items.crearOActualizar(emp.negocioId, sucursalId, dto, { empleadoId: emp.id, ip });
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Delete(':itemCartaId')
  eliminar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('sucursalId') sucursalId: string,
    @Param('itemCartaId') itemCartaId: string, @Ip() ip: string,
  ) {
    return this.items.eliminar(emp.negocioId, sucursalId, itemCartaId, { empleadoId: emp.id, ip });
  }
}