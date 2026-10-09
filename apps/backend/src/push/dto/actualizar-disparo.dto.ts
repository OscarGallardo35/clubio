import { TipoDisparo } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Edicion parcial de un DisparoPush. Sin `@nestjs/mapped-types`: el repo no usa
 * PartialType, asi que cada campo opcional se declara a mano.
 */
export class ActualizarDisparoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  nombre?: string;

  @IsOptional() @IsEnum(TipoDisparo)
  tipo?: TipoDisparo;

  @IsOptional() @IsString()
  plantillaId?: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;

  @IsOptional() @IsObject()
  regalo?: Record<string, unknown>;

  @IsOptional() @IsObject()
  limitePorCliente?: Record<string, unknown>;
}
