import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { PushService } from './push.service';
import { SuscribirPushDto } from './dto/suscribir-push.dto';
import { EnviarPromocionDto } from './dto/enviar-promocion.dto';
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
  constructor(private readonly push: PushService) {}

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
}