import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TipoTurno } from '@prisma/client';

export class FiltrarTurnosDto {
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
  @IsOptional() @IsString() empleadoId?: string;
  @IsOptional() @IsString() sucursalId?: string;
  @IsOptional() @IsEnum(TipoTurno) tipoTurno?: TipoTurno;
}

export class VistaSemanalDto {
  /** Lunes de la semana (YYYY-MM-DD). Si no viene, la semana actual. */
  @IsOptional() @IsString() fechaInicio?: string;
  @IsOptional() @IsString() sucursalId?: string;
}