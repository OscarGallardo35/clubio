import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class AsignarGruposItemDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsString({ each: true })
  grupoIds!: string[];

  /** true = reemplaza las asignaciones previas del item. */
  @IsOptional()
  reemplazar?: boolean;
}