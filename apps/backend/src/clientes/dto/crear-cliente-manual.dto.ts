import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GeneroCliente } from '@prisma/client';

export class CrearClienteManualDto {
  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  /** Se normaliza a E.164 antes de guardar. */
  @IsString()
  telefono!: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsBoolean()
  aceptaNotificaciones?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  notasInternas?: string;

  /** PERFILADO PROGRESIVO: fecha de nacimiento cargada por el dueno (`'YYYY-MM-DD'`). */
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString() @MaxLength(40)
  fechaNacimiento?: string | null;

  /** Genero autodeclarado. Un valor fuera del enum es 400. */
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(GeneroCliente)
  genero?: GeneroCliente | null;
}
