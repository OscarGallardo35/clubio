import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional,
  IsString, Min, ValidateNested,
} from 'class-validator';

export class OverrideItemCartaDto {
  @IsString()
  itemCartaId!: string;

  /** null = usar el precio global del item. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  precio?: number | null;

  /** null = usar la disponibilidad global del item. */
  @IsOptional() @IsBoolean()
  disponible?: boolean | null;
}

export class BulkOverrideItemCartaDto {
  /** true = reemplaza los overrides de esos items en esta sucursal. */
  @IsOptional() @IsBoolean()
  reemplazar?: boolean;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OverrideItemCartaDto)
  items!: OverrideItemCartaDto[];
}