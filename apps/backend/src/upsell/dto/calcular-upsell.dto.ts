import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';

export class ItemCarritoDto {
  @IsString()
  itemId!: string;

  @IsInt() @Min(1) @Max(99)
  cantidad!: number;
}

export class CalcularUpsellDto {
  @IsArray() @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemCarritoDto)
  items!: ItemCarritoDto[];

  /** Default: ConfiguracionClub.upsellMaxSugerencias (3). */
  @IsOptional() @IsInt() @Min(1) @Max(20)
  maxSugerencias?: number;

  /**
   * Se agrega al DTO del prompt: la disponibilidad del item destino puede
   * estar overrideada por sucursal (ItemCartaSucursal), y sin esto el motor
   * sugeriria algo agotado en esa sucursal.
   */
  @IsOptional() @IsString()
  sucursalId?: string;

  @IsOptional() @IsString()
  sucursalSlug?: string;
}