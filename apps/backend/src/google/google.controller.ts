import { Body, Controller, Delete, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RolEmpleado } from '@prisma/client';
import { GoogleService } from './google.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentEmpleado } from '../common/decorators/current-empleado.decorator';
import { StaffGuard } from '../common/guards/staff.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';

interface EmpleadoAuth { id: string; negocioId: string; rol: RolEmpleado }

@Controller('google')
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('estado')
  estado(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.google.estado(emp.negocioId);
  }

  /** Devuelve la URL de consentimiento; el admin redirige al usuario ahi. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('conectar')
  conectar(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.google.urlAutorizacion(emp.negocioId, emp.id);
  }

  /**
   * Callback publico de Google (no lleva JWT: lo llama el navegador de Google).
   * La seguridad la aporta el `state` de un solo uso guardado en Redis.
   */
  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    await this.google.callback(code, state);
    const destino = `${process.env.ADMIN_URL ?? 'http://localhost:3003'}/configuracion/google?conectado=1`;
    return res.redirect(destino);
  }

  /** Cuentas y ubicaciones disponibles para elegir cual sincronizar. */
  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO, RolEmpleado.ENCARGADO)
  @Get('ubicaciones')
  ubicaciones(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.google.descubrirUbicaciones(emp.negocioId);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Post('ubicacion')
  seleccionarUbicacion(
    @CurrentEmpleado() emp: EmpleadoAuth,
    @Body() dto: { accountId: string; locationId: string; accountName?: string; locationName?: string },
  ) {
    return this.google.seleccionarUbicacion(emp.negocioId, emp.id, dto);
  }

  @UseGuards(StaffGuard, TenantGuard, RolesGuard)
  @Roles(RolEmpleado.DUENO)
  @Delete('desconectar')
  desconectar(@CurrentEmpleado() emp: EmpleadoAuth) {
    return this.google.desconectar(emp.negocioId, emp.id);
  }
}