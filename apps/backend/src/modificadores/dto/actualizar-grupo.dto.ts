import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional,
  IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { TipoModificador } from '@prisma/client';

export class ActualizarOpcionDto {
  /** Si viene `id`, se actualiza; si no, se CREA como opcion nueva. */
  @IsOptional() @IsString()
  id?: string;

  @IsString() @MinLength(1) @MaxLength(100)
  nombre!: string;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  precioExtra?: number;

  @IsOptional() @IsBoolean()
  disponible?: boolean;

  @IsOptional() @IsInt() @Min(0)
  orden?: number;
}

export class ActualizarGrupoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @IsOptional() @IsEnum(TipoModificador)
  tipo?: TipoModificador;

  @IsOptional() @IsBoolean()
  obligatorio?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  minSelecciones?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  maxSelecciones?: number;

  @IsOptional() @IsInt() @Min(0)
  orden?: number;

  /** Si viene, REEMPLAZA el set completo de opciones del grupo. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ActualizarOpcionDto)
  opciones?: ActualizarOpcionDto[];
}