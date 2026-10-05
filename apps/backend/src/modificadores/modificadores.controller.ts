import {
  Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ModificadoresService } from './modificadores.service';
import { AsignacionService } from './asignacion.service';
import type { CtxMod } from './modificadores.service';
import { CrearGrupoDto } from './dto/crear-grupo.dto';
import { ActualizarGrupoDto } from './dto/actualizar-grupo.dto';
import { CrearOpcionSueltaDto } from './dto/crear-opcion.dto';
import { ActualizarOpcionSueltaDto } from './dto/actualizar-opcion.dto';
import { ReordenarGruposDto, ReordenarOpcionesDto } from './dto/reordenar-grupos.dto';
import { AsignarGruposItemDto } from './dto/asignar-grupos-item.dto';
import { AsignarBulkDto, DesasignarBulkDto } from './dto/asignar-bulk.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

const LECTURA = [RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY];

@Controller('modificadores')
@UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
export class ModificadoresController {
  constructor(
    private readonly modificadores: ModificadoresService,
    private readonly asignacion: AsignacionService,
  ) {}

  private ctx(emp: EmpleadoAuth, ip: string): CtxMod {
    return { empleadoId: emp.id, ip };
  }

  // ------------------------------------------------------------------ rutas
  // Las rutas literales van ANTES que ':id' para que no las capture.

  @Roles(...LECTURA)
  @Get('grupos')
  listar(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.modificadores.listarGrupos(emp.negocioId);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('grupos')
  crear(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearGrupoDto, @Ip() ip: string) {
    return this.modificadores.crearGrupo(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('grupos/reordenar')
  reordenar(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: ReordenarGruposDto, @Ip() ip: string) {
    return this.modificadores.reordenarGrupos(emp.negocioId, dto, this.ctx(emp, ip));
  }

  // ---- asignacion (antes de ':id') ----
  @Roles(...LECTURA)
  @Get('items')
  items(@CurrentEmpleado() emp: EmpleadoAuth, @Query('itemId') itemId?: string) {
    return this.asignacion.listarItemsConGrupos(emp.negocioId, itemId);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('items/bulk-asignar')
  bulkAsignar(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: AsignarBulkDto, @Ip() ip: string) {
    return this.asignacion.bulkAsignar(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('items/bulk-desasignar')
  bulkDesasignar(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: DesasignarBulkDto, @Ip() ip: string) {
    return this.asignacion.bulkDesasignar(emp.negocioId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('items/:itemId/grupos')
  asignarItem(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('itemId') itemId: string,
    @Body() dto: AsignarGruposItemDto, @Ip() ip: string,
  ) {
    return this.asignacion.asignarAItem(emp.negocioId, itemId, dto, this.ctx(emp, ip));
  }

  @Roles(...LECTURA)
  @Get('grupos/:id')
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.modificadores.obtenerGrupo(emp.negocioId, id);
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Patch('grupos/:id')
  actualizar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ActualizarGrupoDto, @Ip() ip: string,
  ) {
    return this.modificadores.actualizarGrupo(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Patch('grupos/:id/duplicar')
  duplicar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string, @Ip() ip: string) {
    return this.modificadores.duplicarGrupo(emp.negocioId, id, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Delete('grupos/:id')
  eliminar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Query('force') force: string | undefined, @Ip() ip: string,
  ) {
    return this.modificadores.eliminarGrupo(emp.negocioId, id, force === 'true', this.ctx(emp, ip));
  }

  // ---- opciones ----
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('grupos/:id/opciones')
  crearOpcion(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: CrearOpcionSueltaDto, @Ip() ip: string,
  ) {
    return this.modificadores.crearOpcion(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Post('grupos/:id/opciones/reordenar')
  reordenarOpciones(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ReordenarOpcionesDto, @Ip() ip: string,
  ) {
    return this.modificadores.reordenarOpciones(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Patch('grupos/:id/opciones/:opcionId')
  actualizarOpcion(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Param('opcionId') opcionId: string, @Body() dto: ActualizarOpcionSueltaDto, @Ip() ip: string,
  ) {
    return this.modificadores.actualizarOpcion(emp.negocioId, id, opcionId, dto, this.ctx(emp, ip));
  }

  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('modificadores')
  @Delete('grupos/:id/opciones/:opcionId')
  eliminarOpcion(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Param('opcionId') opcionId: string, @Ip() ip: string,
  ) {
    return this.modificadores.eliminarOpcion(emp.negocioId, id, opcionId, this.ctx(emp, ip));
  }
}