import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RecursoLimitado } from '@prisma/client';

export class VerificarLimiteDto {
  @IsEnum(RecursoLimitado)
  recurso!: RecursoLimitado;

  @IsOptional() @IsInt() @Min(1)
  incremento?: number;

  @IsOptional() @IsString()
  sucursalId?: string;
}

export class HistoricoUsoDto {
  // Los query params LLEGAN COMO STRING: sin @Type(() => Number) el @IsInt
  // rechaza "6" y devuelve 400 (el ValidationPipe global tiene transform: true,
  // pero eso no convierte solo).
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  meses?: number;
}