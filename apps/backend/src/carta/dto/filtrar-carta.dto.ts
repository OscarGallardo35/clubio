import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class FiltrarCartaDto {
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsBooleanString() disponible?: string;
  /** Sucursal explicita para aplicar overrides de precio/disponibilidad. */
  @IsOptional() @IsString() sucursalId?: string;
}
