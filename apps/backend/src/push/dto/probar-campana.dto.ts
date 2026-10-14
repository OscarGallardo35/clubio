import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * "Probar a mi mismo" (`POST /push/campanas/probar`): manda UNA notificacion al
 * dispositivo del que la pide (por su `endpoint`), con los textos que se estan
 * editando (no hace falta guardar la campana antes). Las variables se reemplazan
 * con datos de un cliente real del negocio.
 */
export class ProbarCampanaDto {
  /** Endpoint de la suscripcion del navegador que toco "Probar a mi mismo". */
  @IsString()
  endpoint!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  titulo!: string;

  @IsString() @MinLength(1) @MaxLength(500)
  cuerpo!: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsString() @MaxLength(500)
  icono?: string;
}
