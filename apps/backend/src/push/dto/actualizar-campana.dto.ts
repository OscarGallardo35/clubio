import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SEGMENTOS_ENVIO } from './enviar-plantilla.dto';
import type { SegmentoEnvio } from './enviar-plantilla.dto';

/**
 * Edicion / REPROGRAMACION de una campana (`PATCH /push/campanas/:id`).
 *
 * Solo se permite mientras la campana esta `PROGRAMADA`: si ya salio (`ENVIANDO` /
 * `ENVIADA`) o se cancelo, el backend responde 409. Sin `@nestjs/mapped-types`
 * (el repo no usa PartialType): cada campo opcional se declara a mano.
 */
export class ActualizarCampanaDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  nombre?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  titulo?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  cuerpo?: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsString() @MaxLength(500)
  icono?: string;

  @IsOptional() @IsIn(SEGMENTOS_ENVIO)
  segmento?: SegmentoEnvio;

  /** Nueva fecha/hora en ARGENTINA ('YYYY-MM-DDTHH:mm' o ISO con offset). */
  @IsOptional() @IsString()
  programadoPara?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(5000)
  excluirClienteIds?: string[];

  @IsOptional() @IsArray() @IsIn(SEGMENTOS_ENVIO, { each: true })
  excluirSegmentos?: SegmentoEnvio[];
}
