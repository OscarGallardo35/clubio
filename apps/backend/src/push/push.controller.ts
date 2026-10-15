import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { PushService } from './push.service';
import { DisparosService } from './disparos.service';
import { CampanasPushService } from './campanas.service';
import { SuscribirPushDto } from './dto/suscribir-push.dto';
import { EnviarPromocionDto } from './dto/enviar-promocion.dto';
import { CrearPlantillaDto } from './dto/crear-plantilla.dto';
import { ActualizarPlantillaDto } from './dto/actualizar-plantilla.dto';
import { EnviarPlantillaDto } from './dto/enviar-plantilla.dto';
import { CrearDisparoDto } from './dto/crear-disparo.dto';
import { ActualizarDisparoDto } from './dto/actualizar-disparo.dto';
import { ProbarDisparoDto } from './dto/probar-disparo.dto';
import { HistorialDisparosDto } from './dto/historial-disparos.dto';
import { HistorialEnviosDto } from './dto/historial-envios.dto';
import { CrearCampanaDto } from './dto/crear-campana.dto';
import { ActualizarCampanaDto } from './dto/actualizar-campana.dto';
import { PreviewCampanaDto } from './dto/preview-campana.dto';
import { ProbarCampanaDto } from './dto/probar-campana.dto';
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
    private readonly campanas: CampanasPushService,
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

  /**
   * Historial de ENVIOS de push (pestaña "Historial" del admin): una fila por
   * (envio x destinatario x endpoint) con el estado real de entrega y el motivo del
   * fallo, mas el resumen por campaña ("a cuantos les llego"). Paginado y con scope
   * por negocio.
   *
   * Cubre los DOS origenes del historial: las campañas (segmento/todos desde el tab
   * Plantillas) y los disparos del motor.
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('envios/logs')
  historialEnvios(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Query() filtros: HistorialEnviosDto,
  ) {
    return this.push.historialEnvios(emp.negocioId, filtros);
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

  /**
   * Tick FORZADO del motor de CUMPLEANOS (no espera el scheduler de 15 minutos). Sigue el
   * mismo camino idempotente que corre el job (`evaluarCumpleanios`), asi que repetirlo NO
   * duplica el saludo (candado `CUMPLEANOS:<clienteId>:<anioAR>`). Existe por el mismo
   * motivo que `campanas/tick`: el harness verifica contra PROD sin encolar a Redis.
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('disparos/cumpleanos/tick')
  tickCumpleanos(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.disparos.evaluarCumpleanios(new Date(), emp.negocioId);
  }

  // ---- campañas programables (fecha/hora + publico con exclusiones) ----

  /**
   * ALCANCE antes de confirmar ("~N de M suscritos"). Es una ESTIMACION: la base se
   * re-resuelve al momento del envio, asi que el numero puede variar.
   *
   * Va ANTES que `campanas/:id` (por claridad de rutas).
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('campanas/preview')
  previewCampana(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: PreviewCampanaDto) {
    return this.campanas.preview(emp.negocioId, dto);
  }

  /** "Probar a mi mismo": manda UNA notificacion al dispositivo que la pide. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('campanas/probar')
  probarCampana(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: ProbarCampanaDto) {
    return this.campanas.probar(emp.negocioId, dto, emp.id);
  }

  /**
   * Tick FORZADO del dispatcher del negocio (no espera el scheduler de 1 minuto).
   * Es el mismo camino idempotente que corre el job: reclamar antes de encolar.
   */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('campanas/tick')
  tickCampanas(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.campanas.evaluarProgramadas(emp.negocioId);
  }

  /** Campañas programables del negocio, con su estado y "a cuantos les llego" (n/m). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('campanas')
  listarCampanas(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.campanas.listar(emp.negocioId);
  }

  /** Programa una campaña (reserva la cuota del mes al CREAR). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Post('campanas')
  crearCampana(@CurrentEmpleado() emp: EmpleadoAuth, @Body() dto: CrearCampanaDto) {
    return this.campanas.crear(emp.negocioId, dto, emp.id);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('campanas/:id')
  obtenerCampana(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.campanas.obtener(emp.negocioId, id);
  }

  /** Reprogramar/editar el mensaje: SOLO si sigue PROGRAMADA (si no, 409). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Patch('campanas/:id')
  actualizarCampana(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: ActualizarCampanaDto,
  ) {
    return this.campanas.actualizar(emp.negocioId, id, dto, emp.id);
  }

  /** Cancela una campaña PROGRAMADA (devuelve el cupo). Si ya salio: 409. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @RequiereFeature('push')
  @Delete('campanas/:id')
  cancelarCampana(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Param('id') id: string,
    @Body() dto: { motivo?: string },
  ) {
    return this.campanas.cancelar(emp.negocioId, id, dto?.motivo, emp.id);
  }
}