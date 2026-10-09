import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { PushService } from './push.service';
import { DisparosService } from './disparos.service';
import { SuscribirPushDto } from './dto/suscribir-push.dto';
import { EnviarPromocionDto } from './dto/enviar-promocion.dto';
import { CrearPlantillaDto } from './dto/crear-plantilla.dto';
import { ActualizarPlantillaDto } from './dto/actualizar-plantilla.dto';
import { EnviarPlantillaDto } from './dto/enviar-plantilla.dto';
import { CrearDisparoDto } from './dto/crear-disparo.dto';
import { ActualizarDisparoDto } from './dto/actualizar-disparo.dto';
import { ProbarDisparoDto } from './dto/probar-disparo.dto';
import { HistorialDisparosDto } from './dto/historial-disparos.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentCliente } from '../common/decorators/current-cliente.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { JwtClienteGuard } from '../common/guards/jwt-cliente.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';

interface ClienteAuth { id: string; negocioId: string }
interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly disparos: DisparosService,
  ) {}

  /** La PWA necesita esta clave para llamar a pushManager.subscribe(). */
  @Public()
  @Get('vapid-public-key')
  vapid() {
    return this.push.vapidPublica();
  }

  @UseGuards(JwtClienteGuard, TenantGuard, PlanGuard)
  @RequiereFeature('push')
  @Post('suscribir')
  suscribirCliente(@CurrentCliente() cli: ClienteAuth, @Body() dto: SuscribirPushDto) {
    return this.push.suscribirCliente(cli.negocioId, cli.id, dto);
  }

  @UseGuards(JwtClienteGuard, TenantGuard, PlanGuard)
  @RequiereFeature('push')
  @Delete('suscribir')
  desuscribirCliente(@Body() dto: { endpoint: string }) {
    return this.push.desuscribir(dto.endpoint);
  }

  // ---- staff ----

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @RequiereFeature('push')
  @Post('suscribir-empleado')
  suscribirEmpleado(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: SuscribirPushDto) {
    return this.push.suscribirEmpleado(emp.negocioId, emp.id, dto);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('suscripciones')
  resumen(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.push.resumen(emp.negocioId);
  }

  /** Envia una promocion: encola y responde (el envio real es en background). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('promocion')
  promocion(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: EnviarPromocionDto) {
    return this.push.enviarPromocion(emp.negocioId, dto, emp.id);
  }

  // ---- plantillas ----

  /** Variables soportadas + plantillas default sugeridas (para el admin). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('plantillas/sugeridas')
  sugeridas() {
    return this.push.catalogoPlantillas();
  }

  /** Datos de ejemplo (un cliente real del negocio) para la previsualizacion. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('plantillas/ejemplo')
  ejemplo(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.push.datosEjemplo(emp.negocioId);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('plantillas')
  plantillas(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.push.listarPlantillas(emp.negocioId);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('plantillas')
  crearPlantilla(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearPlantillaDto) {
    return this.push.crearPlantilla(emp.negocioId, dto, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Patch('plantillas/:id')
  actualizarPlantilla(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: ActualizarPlantillaDto,
  ) {
    return this.push.actualizarPlantilla(emp.negocioId, id, dto, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Delete('plantillas/:id')
  eliminarPlantilla(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.push.eliminarPlantilla(emp.negocioId, id, emp.id);
  }

  /** Envio por plantilla: campana por segmento o prueba a un dispositivo (`endpoint`). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('enviar')
  enviarPlantilla(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: EnviarPlantillaDto) {
    return this.push.enviarConPlantilla(emp.negocioId, dto, emp.id);
  }

  // ---- disparos (automatizaciones) ----

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('disparos')
  listarDisparos(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.disparos.listar(emp.negocioId);
  }

  /**
   * Historial de ejecuciones del motor de disparos (pestaña "Historial" del admin):
   * una fila por evento con el disparo/plantilla, el cliente, si el push se encolo y
   * cuanto saldo se acredito. Paginado y con scope por negocio.
   *
   * Va ANTES que cualquier `disparos/:id` para que 'logs' no se lea como un id.
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('disparos/logs')
  historialDisparos(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Query() filtros: HistorialDisparosDto,
  ) {
    return this.disparos.historial(emp.negocioId, filtros);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('disparos')
  crearDisparo(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearDisparoDto) {
    return this.disparos.crear(emp.negocioId, dto, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Patch('disparos/:id')
  actualizarDisparo(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: ActualizarDisparoDto,
  ) {
    return this.disparos.actualizar(emp.negocioId, id, dto, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Delete('disparos/:id')
  eliminarDisparo(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.disparos.eliminar(emp.negocioId, id, emp.id);
  }

  /** Dispara YA a un cliente puntual (test). Manda el push, no toca saldos. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('disparos/:id/probar')
  probarDisparo(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: ProbarDisparoDto,
  ) {
    return this.disparos.probar(emp.negocioId, id, dto.clienteId, emp.id);
  }
}