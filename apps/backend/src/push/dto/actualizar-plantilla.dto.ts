import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Edicion parcial de una plantilla. Sin `@nestjs/mapped-types`: el repo no usa
 * PartialType, asi que cada campo opcional se declara a mano.
 */
export class ActualizarPlantillaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  nombre?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  titulo?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  cuerpo?: string;

  @IsOptional() @IsString() @MaxLength(500)
  icono?: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;
}
