import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolEmpleado } from '@prisma/client';
import { VisitasService } from './visitas.service';
import type { ClienteCtx, EmpleadoCtx } from './visitas.service';
import { SolicitarVisitaDto } from './dto/solicitar-visita.dto';
import { AprobarVisitaDto } from './dto/aprobar-visita.dto';
import { RechazarVisitaDto } from './dto/rechazar-visita.dto';
import { HistorialVisitasDto } from './dto/historial-visitas.dto';
import { JwtClienteGuard } from '../common/guards/jwt-cliente.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentCliente } from '../common/decorators/current-cliente.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }

@Controller('visitas')
export class VisitasController {
  constructor(private readonly visitas: VisitasService) {}

  private ctx(emp: EmpleadoAuth, ip: string): EmpleadoCtx {
    return { id: emp.id, negocioId: emp.negocioId, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  /** PWA Cliente: pide sumar su visita (QR #2). */
  @UseGuards(JwtClienteGuard, TenantGuard)
  @Post('solicitar')
  solicitar(@CurrentCliente() cli: ClienteCtx, @Body() dto: SolicitarVisitaDto) {
    return this.visitas.solicitar(cli.negocioId, cli, dto);
  }

  // ----- PWA Cliente (JWT de cliente) -----

  /** Respaldo del WebSocket: la PWA consulta el estado cada 5s si el socket falla. */
  @UseGuards(JwtClienteGuard, TenantGuard)
  @Get('estado/:token')
  estado(@CurrentCliente() cli: ClienteCtx, @Param('token') token: string) {
    return this.visitas.estadoParaCliente(cli.negocioId, cli.id, token);
  }

  /** Tarjeta del cliente (sellos, premio, progreso). Acepta ?sucursalSlug=. */
  @UseGuards(JwtClienteGuard, TenantGuard)
  @Get('mi-tarjeta')
  miTarjeta(@CurrentCliente() cli: ClienteCtx, @Query('sucursalSlug') sucursalSlug?: string) {
    return this.visitas.miTarjeta(cli.negocioId, cli.id, sucursalSlug);
  }

  /** Historial de visitas del propio cliente. */
  @UseGuards(JwtClienteGuard, TenantGuard)
  @Get('mi-historial')
  miHistorial(
    @CurrentCliente() cli: ClienteCtx,
    @Query('sucursalSlug') sucursalSlug?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.visitas.miHistorial(cli.negocioId, cli.id, { sucursalSlug, page, pageSize });
  }

  // ----- de aca para abajo: staff (token de empleado o de dueño) -----

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Get('validar/:token')
  validar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('token') token: string) {
    return this.visitas.validar(emp.negocioId, token, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Post('aprobar/:token')
  aprobar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('token') token: string,
    @Body() dto: AprobarVisitaDto, @Ip() ip: string,
  ) {
    return this.visitas.aprobar(emp.negocioId, token, this.ctx(emp, ip), dto);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Post('rechazar/:token')
  rechazar(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('token') token: string,
    @Body() dto: RechazarVisitaDto, @Ip() ip: string,
  ) {
    return this.visitas.rechazar(emp.negocioId, token, this.ctx(emp, ip), dto);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Get('mis-aprobaciones')
  misAprobaciones(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.visitas.misAprobaciones(emp.negocioId, emp.id);
  }

  /**
   * Cola de solicitudes vivas. La PWA Staff la refresca cada 30s y al reconectar
   * el WS; no depende del WS para no perder pedidos si el socket se cae.
   *
   * 60/min por IP: es un sondeo, no una accion humana.
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('pendientes')
  pendientes(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.visitas.pendientes(emp.negocioId, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('historial')
  historial(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: HistorialVisitasDto) {
    return this.visitas.historial(emp.negocioId, filtros);
  }
}
