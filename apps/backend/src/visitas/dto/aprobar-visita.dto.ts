import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AprobarVisitaDto {
  @IsOptional() @IsString() @MaxLength(40)
  origen?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(1000000)
  montoConsumido?: number;

  @IsOptional() @IsString() @MaxLength(500)
  notas?: string;

  /**
   * Fase 1: pedido del menu (QR #1) del que sale el monto de la visita.
   * Si viene, MANDA sobre `montoConsumido` (lo pone el pedido, no el staff).
   */
  @IsOptional() @IsString() @MaxLength(50)
  pedidoId?: string;

  /** Objetos de la carta consumidos (futuro: modificadores). */
  @IsOptional()
  items?: unknown[];
}
