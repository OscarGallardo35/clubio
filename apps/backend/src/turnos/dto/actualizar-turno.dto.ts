import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TipoTurno } from '@prisma/client';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ActualizarTurnoDto {
  @IsOptional() @IsString() @Matches(HORA, { message: 'horaInicio debe ser HH:mm' })
  horaInicio?: string;

  @IsOptional() @IsString() @Matches(HORA, { message: 'horaFin debe ser HH:mm' })
  horaFin?: string;

  @IsOptional() @IsEnum(TipoTurno)
  tipoTurno?: TipoTurno;

  @IsOptional() @IsString() @MaxLength(500)
  notas?: string;
}