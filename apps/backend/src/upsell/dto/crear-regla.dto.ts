import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CrearReglaDto {
  @IsString() @MinLength(2) @MaxLength(100)
  nombre!: string;

  @IsString() @MinLength(2) @MaxLength(500)
  mensaje!: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  prioridad?: number;

  /** Condicion: itemOrigenId O categoriaOrigen (no ambos). */
  @IsOptional() @IsString()
  itemOrigenId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  categoriaOrigen?: string;

  /** Sugerencia (obligatoria). */
  @IsString()
  itemDestinoId!: string;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  maxVeces?: number;

  @IsOptional() @IsBoolean()
  soloUnaVez?: boolean;
}