import {
  IsBoolean, IsHexColor, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';

export class CrearSucursalDto {
  @IsString() @MinLength(2) @MaxLength(80)
  nombre!: string;

  /** Solo alfanumericos y guiones (va en la URL). */
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug: solo minusculas, numeros y guiones (ej: bar-centro)',
  })
  @MaxLength(60)
  slug!: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(40)
  numeroAtendiente?: string;

  @IsOptional() @IsHexColor()
  colorPrimario?: string;

  @IsOptional() @IsHexColor()
  colorSecundario?: string;

  /**
   * Si es la PRIMERA sucursal del negocio se fuerza esPrincipal=true.
   * Si ya hay principal, esto se ignora (no se puede tener 2).
   */
  @IsOptional() @IsBoolean()
  esPrincipal?: boolean;
}