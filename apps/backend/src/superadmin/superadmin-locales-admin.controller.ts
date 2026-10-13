import {
  Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { SuperadminLocalesService } from './superadmin-locales.service';
import { SuperadminRecursosService } from './superadmin-recursos.service';
import { PlanService } from '../planes/plan.service';
import { CrearLocalSuperAdminDto } from './dto/crear-local.dto';
import { ActualizarLocalSuperAdminDto } from './dto/actualizar-local.dto';
import { ProvisionarLocalSuperAdminDto } from './dto/provisionar-local.dto';
import { ActualizarPlanLocalDto } from './dto/actualizar-plan.dto';
import { CrearItemCartaDto } from '../carta/dto/crear-item-carta.dto';
import { ActualizarItemCartaDto } from '../carta/dto/actualizar-item-carta.dto';
import { ActualizarConfiguracionDto } from '../configuracion/dto/actualizar-configuracion.dto';
import { ActualizarThemeSuperAdminDto } from './dto/actualizar-theme.dto';
import { CrearEmpleadoSuperAdminDto, ActualizarEmpleadoSuperAdminDto } from './dto/actualizar-empleado.dto';
import { CurrentSuperAdmin } from '../common/decorators/current-superadmin.decorator';
import { SuperAdminGuard } from '../common/guards/superadmin.guard';
import { AuditoriaService } from '../common/auditoria/auditoria.service';

interface SuperAdminCtx {
  id: string;
}

/**
 * Administracion de UN local desde el panel de PLATAFORMA: datos base, FABRICA DE DEMOS
 * (`provisionar`), reset de demo, carta, empleados, configuracion del club y theme.
 *
 * Rieles (identicos a los de `superadmin-locales.controller.ts`):
 *  - guard `SuperAdminGuard` y NADA de `TenantGuard`: el super-admin no tiene `negocioId`, asi
 *    que el local SIEMPRE llega como parametro explicito (`:negocioId`) y el servicio lo
 *    valida contra la DB.
 *  - todo auditado con `registrarSuperAdmin` (tambien las lecturas: es un panel de plataforma
 *    y de trafico bajo, y saber quien miro/edito la carta de un local es parte de la trazabilidad).
 *  - los hashes de PIN/password NUNCA salen en una respuesta.
 *
 * El contrato de rutas esta CONGELADO con el front (`apps/pwa-superadmin`).
 */
@UseGuards(SuperAdminGuard)
@Controller('superadmin')
export class SuperAdminLocalesAdminController {
  constructor(
    private readonly locales: SuperadminLocalesService,
    private readonly recursos: SuperadminRecursosService,
    private readonly auditoria: AuditoriaService,
    private readonly planSvc: PlanService,
  ) {}

  /** Un solo lugar para la auditoria de plataforma de este controller. */
  private auditar(
    user: SuperAdminCtx,
    accion: string,
    detalle: unknown,
    negocioId: string | null,
    ip: string | undefined,
    ua: string | undefined,
  ) {
    return this.auditoria.registrarSuperAdmin({
      superAdminId: user.id,
      accion,
      negocioId,
      detalle,
      ip: ip ?? null,
      userAgent: ua ?? null,
    });
  }

  // =========================================================================
  // LOCALES: alta, edicion, detalle, baja total
  // =========================================================================

  /** Crea un local (Negocio activo + sucursal principal + config por defecto). */
  @Post('locales')
  async crear(
    @Body() dto: CrearLocalSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const local = await this.locales.crear(dto);
    await this.auditar(user, 'superadmin.local.creado', { slug: local.slug, plan: local.plan }, local.id, ip, ua);
    return local;
  }

  /** Detalle: local + configuracion + sucursales + contadores. */
  @Get('locales/:negocioId')
  async detalle(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const detalle = await this.locales.detalle(negocioId);
    await this.auditar(user, 'superadmin.local.leido', { slug: detalle.local?.slug ?? null }, negocioId, ip, ua);
    return detalle;
  }

  /** Edita los datos base (nombre, colores, plan, activo/desactivar). */
  @Patch('locales/:negocioId')
  async actualizar(
    @Param('negocioId') negocioId: string,
    @Body() dto: ActualizarLocalSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const local = await this.locales.actualizar(negocioId, dto);
    await this.auditar(user, 'superadmin.local.actualizado', { campos: Object.keys(dto) }, negocioId, ip, ua);
    return local;
  }

  /** Baja TOTAL del local (cascade). Para limpiar un local de prueba. */
  @Delete('locales/:negocioId')
  async eliminar(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const resumen = await this.locales.eliminar(negocioId);
    await this.auditar(user, 'superadmin.local.eliminado', resumen.borrados, negocioId, ip, ua);
    return resumen;
  }

  // =========================================================================
  // PLAN Y FEATURES DEL LOCAL (motor de planes: envuelve `plan.service`)
  // =========================================================================

  /** Lo VIGENTE del negocio: plan efectivo + features (habilitada/limite) + pay-per-use. */
  @Get('locales/:negocioId/plan')
  async plan(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const estado = await this.planSvc.estadoPlanNegocio(negocioId);
    await this.auditar(user, 'superadmin.plan.leido', { plan: estado.plan }, negocioId, ip, ua);
    return estado;
  }

  /**
   * Aplica un cambio de plan / features / pay-per-use. NO reimplementa el motor: delega en
   * `PlanService.aplicarPlanNegocio`, que escribe las features y el pay-per-use y los audita
   * como `super-admin` (`EventoAuditoriaSuperAdmin`). Devuelve lo mismo que el GET.
   */
  @Patch('locales/:negocioId/plan')
  async actualizarPlan(
    @Param('negocioId') negocioId: string,
    @Body() dto: ActualizarPlanLocalDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const estado = await this.planSvc.aplicarPlanNegocio(negocioId, dto, {
      superAdminId: user.id,
      ip,
    });
    await this.auditar(
      user,
      'superadmin.plan.actualizado',
      {
        plan: dto.plan ?? null,
        features: dto.features ? Object.keys(dto.features) : [],
        payPerUseActivo: dto.payPerUseActivo ?? null,
      },
      negocioId, ip, ua,
    );
    return estado;
  }

  // =========================================================================
  // LA FABRICA DE DEMOS
  // =========================================================================

  /** Deja el local listo para la demo (config + theme + carta + empleados + cliente con sellos). */
  @Post('locales/:negocioId/provisionar')
  async provisionar(
    @Param('negocioId') negocioId: string,
    @Body() dto: ProvisionarLocalSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const resultado = await this.locales.provisionar(negocioId, dto);
    await this.auditar(
      user,
      'superadmin.local.provisionado',
      { plantilla: dto.plantilla, items: resultado.items, empleados: resultado.empleados },
      negocioId, ip, ua,
    );
    return resultado;
  }

  /** Vuelve el local al estado de demo: borra los datos de prueba y regenera el cliente demo. */
  @Post('locales/:negocioId/reset-demo')
  async resetDemo(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const resultado = await this.locales.resetDemo(negocioId);
    await this.auditar(user, 'superadmin.local.reset_demo', resultado.borrados, negocioId, ip, ua);
    return resultado;
  }

  // =========================================================================
  // CARTA
  // =========================================================================

  @Get('locales/:negocioId/carta')
  async carta(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const carta = await this.recursos.listarCarta(negocioId);
    await this.auditar(user, 'superadmin.carta.leida', { total: carta.total }, negocioId, ip, ua);
    return carta;
  }

  @Post('locales/:negocioId/carta/items')
  async crearItemCarta(
    @Param('negocioId') negocioId: string,
    @Body() dto: CrearItemCartaDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const item = await this.recursos.crearItemCarta(negocioId, dto);
    await this.auditar(user, 'superadmin.carta.item_creado', { itemId: item.id, nombre: item.nombre }, negocioId, ip, ua);
    return item;
  }

  @Patch('locales/:negocioId/carta/items/:itemId')
  async actualizarItemCarta(
    @Param('negocioId') negocioId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ActualizarItemCartaDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const item = await this.recursos.actualizarItemCarta(negocioId, itemId, dto);
    await this.auditar(user, 'superadmin.carta.item_actualizado', { itemId, campos: Object.keys(dto) }, negocioId, ip, ua);
    return item;
  }

  /** Baja logica: el item queda no disponible. */
  @Delete('locales/:negocioId/carta/items/:itemId')
  async eliminarItemCarta(
    @Param('negocioId') negocioId: string,
    @Param('itemId') itemId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const item = await this.recursos.eliminarItemCarta(negocioId, itemId);
    await this.auditar(user, 'superadmin.carta.item_desactivado', { itemId }, negocioId, ip, ua);
    return item;
  }

  // =========================================================================
  // EMPLEADOS
  // =========================================================================

  @Get('locales/:negocioId/empleados')
  async empleados(
    @Param('negocioId') negocioId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const empleados = await this.recursos.listarEmpleados(negocioId);
    await this.auditar(user, 'superadmin.empleados.listado', { total: empleados.total }, negocioId, ip, ua);
    return empleados;
  }

  @Post('locales/:negocioId/empleados')
  async crearEmpleado(
    @Param('negocioId') negocioId: string,
    @Body() dto: CrearEmpleadoSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const empleado = await this.recursos.crearEmpleado(negocioId, dto);
    await this.auditar(
      user,
      'superadmin.empleado.creado',
      { empleadoId: empleado.id, rol: empleado.rol, email: empleado.email, tienePin: empleado.tienePin },
      negocioId, ip, ua,
    );
    return empleado;
  }

  @Patch('locales/:negocioId/empleados/:empleadoId')
  async actualizarEmpleado(
    @Param('negocioId') negocioId: string,
    @Param('empleadoId') empleadoId: string,
    @Body() dto: ActualizarEmpleadoSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const empleado = await this.recursos.actualizarEmpleado(negocioId, empleadoId, dto);
    await this.auditar(
      user,
      'superadmin.empleado.actualizado',
      // `Object.keys(dto)` y nunca los valores: puede venir password/pin en claro.
      { empleadoId, campos: Object.keys(dto) },
      negocioId, ip, ua,
    );
    return empleado;
  }

  /** Baja logica (activo=false + eliminadoEn) e invalida sus sesiones. */
  @Delete('locales/:negocioId/empleados/:empleadoId')
  async eliminarEmpleado(
    @Param('negocioId') negocioId: string,
    @Param('empleadoId') empleadoId: string,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const empleado = await this.recursos.eliminarEmpleado(negocioId, empleadoId);
    await this.auditar(user, 'superadmin.empleado.desactivado', { empleadoId }, negocioId, ip, ua);
    return empleado;
  }

  // =========================================================================
  // CONFIGURACION DEL CLUB + THEME
  // =========================================================================

  /** Modo, sellos, premio, numero de WhatsApp, etc. Delega en el servicio del dueno. */
  @Patch('locales/:negocioId/configuracion')
  async configuracion(
    @Param('negocioId') negocioId: string,
    @Body() dto: ActualizarConfiguracionDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const config = await this.recursos.actualizarConfiguracion(negocioId, dto, { ip });
    await this.auditar(user, 'superadmin.configuracion.actualizada', { campos: Object.keys(dto) }, negocioId, ip, ua);
    return config;
  }

  /** Theme/branding de la tarjeta (`Negocio.theme`). Merge sobre el theme existente. */
  @Patch('locales/:negocioId/theme')
  async theme(
    @Param('negocioId') negocioId: string,
    @Body() dto: ActualizarThemeSuperAdminDto,
    @CurrentSuperAdmin() user: SuperAdminCtx,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    const theme = await this.recursos.actualizarTheme(negocioId, dto);
    await this.auditar(user, 'superadmin.theme.actualizado', { campos: Object.keys(dto) }, negocioId, ip, ua);
    return theme;
  }
}
