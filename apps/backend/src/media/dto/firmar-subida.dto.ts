import { IsIn, IsOptional } from 'class-validator';
import { TIPOS_MEDIA } from '../media.service';
import type { TipoMedia } from '../media.service';

/**
 * Body de `POST /media/firmar-subida`.
 *
 * NO tiene `negocioId` a proposito: el negocio sale del token. Declararlo lo dejaria pasar por el
 * ValidationPipe (`whitelist`), y con `forbidNonWhitelisted` cualquier intento de mandarlo se
 * rechaza con 400 antes de llegar al servicio.
 */
export class FirmarSubidaDto {
  /** Que tipo de imagen se sube (define la subcarpeta). Hoy solo existe `carta`. */
  @IsOptional()
  @IsIn([...TIPOS_MEDIA])
  tipo?: TipoMedia;
}
