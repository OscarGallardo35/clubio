import {
  Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { TurnosService } from './turnos.service';
import { CheckinService } from './checkin.service';
import type { CtxTurno } from './turnos.service';
import { BulkCrearTurnosDto, CrearTurnoDto } from './dto/crear-turno.dto';
import { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import { FiltrarTurnosDto, VistaSemanalDto } from './dto/filtrar-turnos.dto';
import { DuplicarDiaDto, DuplicarSemanaDto } from './dto/duplicar-semana.dto';
import { AsignarEncargadoDto } from './dto/asignar-encargado.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

const LECTURA = [RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY];

@Controller('turnos')
@UseGuards(StaffGuard, TenantGuard, RolesGuard)
export class TurnosController {
  constructor(
    private readonly turnos: TurnosService,
    private readonly checkin: CheckinService,
  ) {}

  private ctx(emp: EmpleadoAuth, ip: string): CtxTurno {
    return { empleadoId: emp.id, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  // Rutas literales ANTES de ':id'

  @Roles(...LECTURA)
  @Get()
  listar(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarTurnosDto) {
    return this.turnos.listar(emp.negocioId, filtros, this.ctx(emp, ''));
  }

  @Roles(...LECTURA)
  @Get('semana')
  semana(@CurrentEmpleado() emp: EmpleadoAuth, @Query() dto: VistaSemanalDto) {
    return this.turnos.vistaSemanal(emp.negocioId, dto, this.ctx(emp, ''));
  }

  @Roles(...LECTURA)
  @Get('empleado/:empleadoId/semana')
  semanaEmpleado(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('empleadoId') empleadoId: string,
    @Query('fechaInicio') fechaInicio?: string,
  ) {
    return this.turnos.turnosDeEmpleadoSemana(emp.negocioId, empleadoId, fechaInicio, this.ctx(emp, ''));
  }

  // ---- check-in (el propio empleado) ----
  @Roles(...LECTURA)
  @Get('checkin/estado')
  estadoCheckin(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.checkin.estado(emp.negocioId, emp.id);
  }

  @Roles(...LECTURA)
  @Get('presentes')
  presentes(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.checkin.presentes(emp.negocioId, emp.sucursalId);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('bulk')
  bulk(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: BulkCrearTurnosDto, @Ip() ip: string) {
    return this.turnos.crearBulk(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('duplicar-semana')
  duplicarSemana(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: DuplicarSemanaDto, @Ip() ip: string) {
    return this.turnos.duplicarSemana(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('duplicar-dia')
  duplicarDia(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: DuplicarDiaDto, @Ip() ip: string) {
    return this.turnos.duplicarDia(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Patch('encargado')
  asignarEncargado(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: AsignarEncargadoDto, @Ip() ip: string) {
    return this.turnos.asignarEncargado(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Delete('encargado/:fecha')
  eliminarEncargado(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('fecha') fecha: string,
    @Query('sucursalId') sucursalId: string | undefined, @Ip() ip: string,
  ) {
    return this.turnos.eliminarEncargado(emp.negocioId, fecha, sucursalId, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post()
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearTurnoDto, @Ip() ip: string) {
    return this.turnos.crear(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(...LECTURA)
  @Get(':id')
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.turnos.obtener(emp.negocioId, id);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Patch(':id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ActualizarTurnoDto, @Ip() ip: string,
  ) {
    return this.turnos.actualizar(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Delete(':id')
  eliminar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.turnos.eliminar(emp.negocioId, id, this.ctx(emp, ip));
  }
}