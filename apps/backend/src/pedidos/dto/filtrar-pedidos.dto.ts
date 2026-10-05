import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TipoPedido } from '@prisma/client';

export class FiltrarPedidosDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;

  /** Uno o varios estados separados por coma: "PENDIENTE,CONFIRMADO". */
  @IsOptional() @IsString()
  estado?: string;

  @IsOptional() @IsEnum(TipoPedido) tipo?: TipoPedido;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;

  @IsOptional() @IsString() @MaxLength(30)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(20)
  mesa?: string;

  @IsOptional() @IsString()
  sucursalId?: string;

  /** Solo el historial: incluye los cerrados. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  incluirCerrados?: boolean;
}