import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional,
  IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { TipoModificador } from '@prisma/client';

export class CrearOpcionDto {
  @IsString() @MinLength(1) @MaxLength(100)
  nombre!: string;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  precioExtra?: number;

  @IsOptional() @IsBoolean()
  disponible?: boolean;

  @IsOptional() @IsInt() @Min(0)
  orden?: number;
}

export class CrearGrupoDto {
  @IsString() @MinLength(2) @MaxLength(100)
  nombre!: string;

  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @IsEnum(TipoModificador)
  tipo!: TipoModificador;

  @IsOptional() @IsBoolean()
  obligatorio?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  minSelecciones?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  maxSelecciones?: number;

  @IsOptional() @IsInt() @Min(0)
  orden?: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CrearOpcionDto)
  opciones!: CrearOpcionDto[];
}