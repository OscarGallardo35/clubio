import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EstadoPedido } from '@prisma/client';

export class CambiarEstadoPedidoDto {
  /** PENDIENTE no es aceptable: es el estado inicial. */
  @IsEnum(EstadoPedido)
  estado!: EstadoPedido;

  /** Obligatorio (min 10 chars) cuando estado = RECHAZADO. */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(300)
  motivo?: string;
}