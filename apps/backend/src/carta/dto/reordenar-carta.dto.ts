import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ItemOrdenDto {
  @IsString()
  id!: string;

  @IsInt() @Min(0)
  orden!: number;
}

export class ReordenarCartaDto {
  /** Batch: se actualiza el orden de cada item en una sola transaccion. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemOrdenDto)
  items!: ItemOrdenDto[];
}
