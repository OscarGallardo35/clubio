import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de una plantilla de push. `nombre` es la etiqueta interna (como la ve el
 * admin); `titulo`/`cuerpo` es lo que ve el cliente. Cuerpo y titulo admiten
 * variables {{nombre}} {{negocio}} {{premio}} {{actuales}} {{meta}} {{faltantes}} {{numero}}.
 */
export class CrearPlantillaDto {
  @IsString() @MinLength(2) @MaxLength(80)
  nombre!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  titulo!: string;

  @IsString() @MinLength(1) @MaxLength(500)
  cuerpo!: string;

  @IsOptional() @IsString() @MaxLength(500)
  icono?: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;
}
