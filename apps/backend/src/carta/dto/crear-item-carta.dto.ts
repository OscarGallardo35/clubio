import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CrearItemCartaDto {
  @IsString() @MinLength(2) @MaxLength(60)
  categoria!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  descripcion?: string;

  @IsNumber() @Min(0)
  precio!: number;

  @IsOptional() @IsString() @MaxLength(500)
  fotoUrl?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  etiquetas?: string[];

  @IsOptional() @IsBoolean()
  disponible?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  orden?: number;
}
