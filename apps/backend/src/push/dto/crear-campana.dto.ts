import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SEGMENTOS_ENVIO } from './enviar-plantilla.dto';
import type { SegmentoEnvio } from './enviar-plantilla.dto';

/**
 * Alta de una campana de push PROGRAMABLE (`POST /push/campanas`).
 *
 * El PUBLICO se re-resuelve al momento del ENVIO (no se congela al crear): la base
 * puede cambiar entre que se programa y se despacha. Las `excluir*` SIEMPRE se
 * respetan; por eso el alcance que devuelve `/push/campanas/preview` es una
 * ESTIMACION.
 *
 * `programadoPara` viaja en hora ARGENTINA de pared ('YYYY-MM-DDTHH:mm'); el backend
 * la convierte a UTC (ver `fechaArgentinaAUtc`). Tambien acepta un ISO con offset.
 */
export class CrearCampanaDto {
  @IsString() @MinLength(2) @MaxLength(100)
  nombre!: string;

  /** Plantilla usada (opcional): los textos igual se snapshotean en la campana. */
  @IsOptional() @IsString()
  plantillaId?: string;

  @IsString() @MinLength(1) @MaxLength(120)
  titulo!: string;

  @IsString() @MinLength(1) @MaxLength(500)
  cuerpo!: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @IsOptional() @IsString() @MaxLength(500)
  icono?: string;

  /** Base del publico ('TODOS' por defecto). */
  @IsOptional() @IsIn(SEGMENTOS_ENVIO)
  segmento?: SegmentoEnvio;

  /** 'YYYY-MM-DDTHH:mm' en hora ARGENTINA (o ISO con offset). */
  @IsString()
  programadoPara!: string;

  /** Clientes a EXCLUIR del envio (siempre se respetan). */
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(5000)
  excluirClienteIds?: string[];

  /** Segmentos NEGATIVOS: se recortan de la base. */
  @IsOptional() @IsArray() @IsIn(SEGMENTOS_ENVIO, { each: true })
  excluirSegmentos?: SegmentoEnvio[];
}
