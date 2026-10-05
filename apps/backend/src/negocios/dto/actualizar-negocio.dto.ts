import { IsHexColor, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class ActualizarNegocioDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(30)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsUrl()
  logoUrl?: string;

  @IsOptional() @IsHexColor()
  colorPrimario?: string;

  @IsOptional() @IsHexColor()
  colorSecundario?: string;

  @IsOptional() @IsString() @MaxLength(120)
  placeId?: string;
}
