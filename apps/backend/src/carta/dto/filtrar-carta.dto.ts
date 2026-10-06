import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';

export class FiltrarCartaDto {
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsBooleanString() disponible?: string;
  /** Sucursal explicita para aplicar overrides de precio/disponibilidad. */
  @IsOptional() @IsString() sucursalId?: string;

  /**
   * La PWA Cliente resuelve la sucursal por SLUG (el QR trae ?sucursal=norte),
   * no por id. Sin esto la carta caia siempre en la principal y los overrides de
   * precio de la otra sucursal no se aplicaban nunca.
   */
  @IsOptional() @IsString() @MaxLength(60) sucursalSlug?: string;
}
