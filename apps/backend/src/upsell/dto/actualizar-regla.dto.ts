import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ActualizarReglaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  nombre?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(500)
  mensaje?: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  prioridad?: number;

  @IsOptional() @IsString()
  itemOrigenId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  categoriaOrigen?: string;

  @IsOptional() @IsString()
  itemDestinoId?: string;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  maxVeces?: number;

  @IsOptional() @IsBoolean()
  soloUnaVez?: boolean;
}