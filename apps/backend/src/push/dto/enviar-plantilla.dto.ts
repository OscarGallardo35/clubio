import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Segmentos de envio por plantilla. */
export const SEGMENTOS_ENVIO = ['TODOS', 'PREMIO_DESBLOQUEADO', 'INACTIVO_30'] as const;
export type SegmentoEnvio = (typeof SEGMENTOS_ENVIO)[number];

/**
 * Envio de una plantilla.
 *
 * Dos modos:
 *  - Campana por segmento: { plantillaId, segmento }
 *  - Prueba a UN dispositivo: { plantillaId, endpoint }  (el endpoint de la
 *    suscripcion del navegador que toco "Enviar prueba")
 *
 * `titulo`/`cuerpo`/`url` permiten pisar la plantilla guardada (asi se prueba lo
 * que se esta editando sin haberlo guardado).
 */
export class EnviarPlantillaDto {
  @IsString()
  plantillaId!: string;

  @IsOptional() @IsIn(SEGMENTOS_ENVIO)
  segmento?: SegmentoEnvio;

  /** Prueba a una suscripcion concreta (por endpoint). */
  @IsOptional() @IsString()
  endpoint?: string;

  // Overrides para la prueba (opcionales).
  @IsOptional() @IsString() @MaxLength(120)
  titulo?: string;

  @IsOptional() @IsString() @MaxLength(500)
  cuerpo?: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;
}
