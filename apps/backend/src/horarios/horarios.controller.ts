import { Body, Controller, Delete, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { HorariosService } from './horarios.service';
import { CrearExcepcionHorarioDto } from './dto/crear-excepcion-horario.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

@Controller('horarios')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class HorariosController {
  constructor(private readonly horarios: HorariosService) {}

  /** Estado del local AHORA (atencion + delivery). Lo usa el badge del staff. */
  @Roles(
    RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO,
    RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY,
  )
  @Get('estado')
  estado(@CurrentEmpleado() emp: EmpleadoAuth, @Query('sucursalId') sucursalId?: string) {
    return this.horarios.estadoLocal(emp.negocioId, sucursalId || emp.sucursalId || null);
  }

  /** Feriados / cierres temporales cargados. */
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('excepciones')
  excepciones(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.horarios.listarExcepciones(emp.negocioId);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('excepciones')
  crearExcepcion(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Body() dto: CrearExcepcionHorarioDto,
    @Ip() ip: string,
  ) {
    return this.horarios.crearExcepcion(
      emp.negocioId,
      { desdeFecha: dto.desdeFecha, hastaFecha: dto.hastaFecha, motivo: dto.motivo ?? null, sucursalId: dto.sucursalId ?? null },
      { empleadoId: emp.id, ip },
    );
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Delete('excepciones/:id')
  eliminarExcepcion(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    return this.horarios.eliminarExcepcion(emp.negocioId, id, { empleadoId: emp.id, ip });
  }
}
