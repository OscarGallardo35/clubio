import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
