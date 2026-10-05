import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/** Refinamiento 2: asignar varios grupos a varios items de una sola vez. */
export class AsignarBulkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsString({ each: true })
  grupoIds!: string[];

  /** true = elimina las asignaciones previas de esos items antes de asignar. */
  @IsOptional() @IsBoolean()
  reemplazar?: boolean;
}

export class DesasignarBulkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsString({ each: true })
  grupoIds!: string[];
}