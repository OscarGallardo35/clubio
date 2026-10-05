import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EtiquetaCliente } from '@prisma/client';

export class ActualizarClienteDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsEnum(EtiquetaCliente)
  etiqueta?: EtiquetaCliente;

  @IsOptional() @IsBoolean()
  aceptaNotificaciones?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  notasInternas?: string;
}
