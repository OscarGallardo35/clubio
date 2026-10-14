import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { SEGMENTOS_ENVIO } from './enviar-plantilla.dto';
import type { SegmentoEnvio } from './enviar-plantilla.dto';

/**
 * Alcance ANTES de confirmar (`POST /push/campanas/preview`).
 *
 * Devuelve a cuantos les va a llegar HOY (`alcanzables`) de los `suscritos` del
 * segmento, con el desglose de exclusiones. Es una ESTIMACION: la base se
 * re-resuelve al momento del envio, asi que el numero puede variar.
 */
export class PreviewCampanaDto {
  @IsOptional() @IsIn(SEGMENTOS_ENVIO)
  segmento?: SegmentoEnvio;

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(5000)
  excluirClienteIds?: string[];

  @IsOptional() @IsArray() @IsIn(SEGMENTOS_ENVIO, { each: true })
  excluirSegmentos?: SegmentoEnvio[];
}
