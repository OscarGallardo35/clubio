import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ActualizarOpcionSueltaDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  nombre?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  precioExtra?: number;

  @IsOptional() @IsBoolean()
  disponible?: boolean;

  @IsOptional() @IsInt() @Min(0)
  orden?: number;
}