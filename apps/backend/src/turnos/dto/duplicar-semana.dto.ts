import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class DuplicarSemanaDto {
  @IsString() @Matches(FECHA)
  fechaInicioSemanaOrigen!: string;

  @IsString() @Matches(FECHA)
  fechaInicioSemanaDestino!: string;

  /** true = reemplaza los turnos existentes en el destino. */
  @IsOptional() @IsBoolean()
  sobrescribir?: boolean;
}

export class DuplicarDiaDto {
  @IsString() @Matches(FECHA)
  fechaOrigen!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31) @IsString({ each: true })
  fechasDestino!: string[];
}