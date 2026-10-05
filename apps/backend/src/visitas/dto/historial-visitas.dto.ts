import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MetodoVisita, TipoVisita } from '@prisma/client';

export class HistorialVisitasDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsString() sucursalId?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() empleadoId?: string;
  @IsOptional() @IsEnum(TipoVisita) tipo?: TipoVisita;
  @IsOptional() @IsEnum(MetodoVisita) metodo?: MetodoVisita;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
}
