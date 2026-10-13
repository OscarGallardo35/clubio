import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { TIPOS_MEDIA } from '../../media/media.service';
import type { TipoMedia } from '../../media/media.service';

/**
 * Body de `POST /superadmin/media/firmar-subida` (firma de subida desde el panel de plataforma).
 *
 * A DIFERENCIA del DTO del dueno (`FirmarSubidaDto`), aca el `negocioId` SI va en el body y es
 * OBLIGATORIO: el super-admin no tiene tenant (no hay `negocioId` en su token) y el panel
 * administra varios locales, asi que el local de la foto es un dato de la request. El servicio lo
 * valida contra la DB antes de firmar.
 */
export class FirmarSubidaSuperAdminDto {
  /** Local al que pertenece la foto (el panel administra varios). */
  @IsString()
  @MinLength(1)
  negocioId!: string;

  /** Que tipo de imagen se sube (define la subcarpeta). Hoy solo existe `carta`. */
  @IsOptional()
  @IsIn([...TIPOS_MEDIA])
  tipo?: TipoMedia;
}
