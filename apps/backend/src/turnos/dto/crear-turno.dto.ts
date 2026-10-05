import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString,
  Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { TipoTurno } from '@prisma/client';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CrearTurnoDto {
  @IsString()
  empleadoId!: string;

  @IsOptional() @IsString()
  sucursalId?: string;

  /** YYYY-MM-DD */
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe ser YYYY-MM-DD' })
  fecha!: string;

  @IsString() @Matches(HORA, { message: 'horaInicio debe ser HH:mm (ej: 09:00)' })
  horaInicio!: string;

  @IsString() @Matches(HORA, { message: 'horaFin debe ser HH:mm (ej: 17:00)' })
  horaFin!: string;

  @IsEnum(TipoTurno)
  tipoTurno!: TipoTurno;

  @IsOptional() @IsString() @MaxLength(500)
  notas?: string;
}

export class BulkCrearTurnosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CrearTurnoDto)
  turnos!: CrearTurnoDto[];
}