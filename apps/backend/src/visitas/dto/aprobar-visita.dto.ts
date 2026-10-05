import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AprobarVisitaDto {
  @IsOptional() @IsString() @MaxLength(40)
  origen?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  montoConsumido?: number;

  @IsOptional() @IsString() @MaxLength(500)
  notas?: string;

  /** Objetos de la carta consumidos (futuro: modificadores). */
  @IsOptional()
  items?: unknown[];
}
