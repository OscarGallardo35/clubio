import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { RolEmpleado } from '@prisma/client';

export class ActualizarEmpleadoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsEnum(RolEmpleado)
  rol?: RolEmpleado;

  @IsOptional() @IsString()
  sucursalId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional() @IsBoolean()
  accesoMultiSucursal?: boolean;

  /**
   * Permiso por empleado para administrar la carta COMPLETA (precio, descripcion,
   * disponibilidad, foto, crear, eliminar y reordenar). Lo prende/apaga el dueno.
   */
  @IsOptional() @IsBoolean()
  puedeEditarCarta?: boolean;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}

export class ResetPinDto {
  @IsString() @Length(4, 8) @Matches(/^\d+$/, { message: 'El PIN debe ser numerico' })
  pin!: string;
}
