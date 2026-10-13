import {
  IsBoolean, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, MinLength,
} from 'class-validator';
import { RolEmpleado } from '@prisma/client';

/**
 * Alta de empleado desde el panel de PLATAFORMA (`POST /locales/:negocioId/empleados`).
 *
 * Espeja `CrearEmpleadoDto` del admin del dueno SALVO `sucursalId`: aca no se pide, el
 * backend resuelve la sucursal PRINCIPAL del local (el operador no elige sucursal).
 */
export class CrearEmpleadoSuperAdminDto {
  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  @IsEnum(RolEmpleado)
  rol!: RolEmpleado;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  /** Se guarda hasheado con bcrypt. */
  @IsOptional() @IsString() @MinLength(6) @MaxLength(120)
  password?: string;

  /** PIN de 4 a 8 digitos (se guarda hasheado). */
  @IsOptional() @IsString() @Length(4, 8) @Matches(/^\d+$/, { message: 'El PIN debe ser numerico' })
  pin?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;
}

/** Edicion de un empleado (`PATCH /locales/:negocioId/empleados/:empleadoId`). */
export class ActualizarEmpleadoSuperAdminDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nombre?: string;
  @IsOptional() @IsEnum(RolEmpleado) rol?: RolEmpleado;
  @IsOptional() @IsString() @MaxLength(120) email?: string | null;
  @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @IsOptional() @IsBoolean() activo?: boolean;

  /** Si viene, REEMPLAZA el hash de la password (nunca se lee ni se devuelve). */
  @IsOptional() @IsString() @MinLength(6) @MaxLength(120) password?: string;
  /** Si viene, REEMPLAZA el PIN (se exige que no lo use otro empleado activo). */
  @IsOptional() @IsString() @Length(4, 8) @Matches(/^\d+$/, { message: 'El PIN debe ser numerico' })
  pin?: string;
}
