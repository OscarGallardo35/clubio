import { IsEnum, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { RolEmpleado } from '@prisma/client';

export class CrearEmpleadoDto {
  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  @IsEnum(RolEmpleado)
  rol!: RolEmpleado;

  @IsString()
  sucursalId!: string;

  /** PIN de 4 a 8 digitos (se guarda hasheado con bcrypt). */
  @IsOptional() @IsString() @Length(4, 8) @Matches(/^\d+$/)
  pin?: string;

  /** Solo para rol DUENO. */
  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsString() @MinLength(6) @MaxLength(120)
  password?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional()
  accesoMultiSucursal?: boolean;
}
