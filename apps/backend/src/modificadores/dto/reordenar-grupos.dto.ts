import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class OrdenItemDto {
  @IsString() id!: string;

  @IsInt() @Min(0) orden!: number;
}

export class ReordenarGruposDto {
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrdenItemDto)
  items!: OrdenItemDto[];
}

export class ReordenarOpcionesDto {
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrdenItemDto)
  items!: OrdenItemDto[];
}