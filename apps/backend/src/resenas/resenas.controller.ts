import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';
import { ResenasService } from './resenas.service';
import type { ResenaCtx } from './resenas.service';
import { FiltrarResenasDto, ResponderResenaDto } from './dto/resenas.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('resenas')
export class ResenasController {
  constructor(private readonly resenas: ResenasService) {}

  private ctx(emp: EmpleadoAuth, ip: string): ResenaCtx {
    return { empleadoId: emp.id, rol: emp.rol, ip };
  }

  /** Publica: solo >= 3 estrellas, cacheada 5 min. */
  @Public()
  @UseGuards(TenantGuard)
  @Get()
  publica(@Tenant() tenant: string | null) {
    return this.resenas.listarPublico(tenant as string);
  }

  /**
   * Webhook de Google Pub/Sub. Publico (no lleva JWT): la autenticidad la da
   * el token compartido validado con timingSafeEqual, y la idempotencia
   * WebhookLog.@@unique([origen, externalId]).
   */
  @Public()
  @Post('webhook')
  webhook(@Body() body: Record<string, any>, @Query('token') token?: string) {
    return this.resenas.procesarWebhookPubSub(body, token);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('admin')
  admin(@CurrentEmpleado() emp: EmpleadoAuth, @Query() filtros: FiltrarResenasDto) {
    return this.resenas.listarAdmin(emp.negocioId, filtros);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post('sincronizar')
  sincronizar(@CurrentEmpleado() emp: EmpleadoAuth, @Ip() ip: string) {
    return this.resenas.sincronizar(emp.negocioId, this.ctx(emp, ip));
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Post(':id/responder')
  responder(
    @CurrentEmpleado() emp: EmpleadoAuth, @Param('id') id: string,
    @Body() dto: ResponderResenaDto, @Ip() ip: string,
  ) {
    return this.resenas.responder(emp.negocioId, id, dto.texto, this.ctx(emp, ip));
  }
}