
import {
  Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolEmpleado } from '@prisma/client';
import { PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { CambiarEstadoPedidoDto } from './dto/cambiar-estado-pedido.dto';
import { FiltrarPedidosDto } from './dto/filtrar-pedidos.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentCliente } from '../common/decorators/current-cliente.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../planes/plan.guard';
import { RequiereFeature } from '../planes/requiere-feature.decorator';
import { JwtClienteGuard } from '../common/guards/jwt-cliente.guard';
import type { PedidoCtx } from './interfaces/pedido-item.interface';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado; sucursalId: string }
interface ClienteAuth { id: string; negocioId: string }

@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  private ctx(emp: EmpleadoAuth, ip: string): PedidoCtx {
    return { empleadoId: emp.id, rol: emp.rol, sucursalId: emp.sucursalId, ip };
  }

  // ==========================================================================
  // RUTAS PUBLICAS (van primero: si no, ':id' capturaria 'publico'/'estadisticas')
  // ==========================================================================

  /**
   * Crea el pedido. Publico, pero si llega un JWT de cliente valido se vincula
   * (refinamiento 4). Token invalido NO rechaza: se trata como guest.
   * Rate limit: 10 por hora por IP (refinamiento 7).
   */
  @Public()
  @UseGuards(TenantGuard, PlanGuard)
  // Refinamiento 7: 10 por hora por IP. Configurable por env para poder
  // correr suites e2e sin que el propio limite corte los tests.
  @Throttle({
    default: {
      limit: Number(process.env.RATE_PEDIDOS_CREATE_LIMIT ?? 10),
      ttl: Number(process.env.RATE_PEDIDOS_CREATE_TTL_MS ?? 3_600_000),
    },
  })
  @RequiereFeature('pedidos')
  @Post()
  async crear(
    @Tenant() tenant: string | null,
    @Body() dto: CrearPedidoDto,
    @Headers('authorization') auth?: string,
  ) {
    const negocioId = await this.pedidos.negocioPorSlug(tenant);
    const clienteId = await this.pedidos.identificarClienteOpcional(auth);
    return this.pedidos.crearPedido(negocioId, dto, clienteId);
  }

  /** El atendiente abre el link del WhatsApp. 30 req/min por IP. */
  @Public()
  @UseGuards(TenantGuard)
  @Throttle({
    default: {
      limit: Number(process.env.RATE_PEDIDOS_LINK_LIMIT ?? 30),
      ttl: Number(process.env.RATE_PEDIDOS_LINK_TTL_MS ?? 60_000),
    },
  })
  @Get('publico/:linkToken')
  async publico(@Tenant() tenant: string | null, @Param('linkToken') linkToken: string) {
    const negocioId = await this.pedidos.negocioPorSlug(tenant);
    return this.pedidos.obtenerPedidoPorLink(negocioId, linkToken);
  }

  // ==========================================================================
  // STAFF
  // ==========================================================================

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('estadisticas')
  estadisticas(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.pedidos.obtenerEstadisticas(emp.negocioId, desde, hasta);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('historial')
  historial(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarPedidosDto) {
    return this.pedidos.historial(emp.negocioId, filtros, { sucursalId: emp.sucursalId, rol: emp.rol });
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Get()
  listar(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarPedidosDto) {
    return this.pedidos.listarPedidos(emp.negocioId, filtros, { sucursalId: emp.sucursalId, rol: emp.rol });
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard, PlanGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @RequiereFeature('pedidos')
  @Patch(':id/estado')
  cambiarEstado(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: CambiarEstadoPedidoDto, @Ip() ip: string,
  ) {
    return this.pedidos.cambiarEstado(emp.negocioId, id, dto, this.ctx(emp, ip));
  }

  /** #2.8: el empleado toma el pedido (solo en modo BROADCAST). */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Patch(':id/tomar')
  tomar(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.pedidos.tomarPedido(emp.negocioId, id, {
      id: emp.id, nombre: (emp as unknown as { nombre?: string }).nombre ?? emp.id,
      sucursalId: emp.sucursalId,
    });
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO, RolEmpleado.CAJERO, RolEmpleado.MESERO, RolEmpleado.EMPLEADO, RolEmpleado.DELIVERY)
  @Get(':id')
  obtener(@CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string) {
    return this.pedidos.obtenerPedido(emp.negocioId, id);
  }

  // ==========================================================================
  // CLIENTE
  // ==========================================================================

  @UseGuards(JwtClienteGuard, TenantGuard)
  @Patch(':id/cancelar')
  cancelar(@CurrentCliente() cli: ClienteAuth, @Param('id') id: string) {
    return this.pedidos.cancelarPedido(cli.negocioId, id, cli.id);
  }
}
