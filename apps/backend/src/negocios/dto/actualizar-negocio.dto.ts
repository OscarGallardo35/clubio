import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { HexColorObligatorio, OpcionalSinNulo } from '../../common/validators/opcional-sin-nulo.validator';

/**
 * Edicion de los datos base del negocio desde el admin del DUENO (`PATCH /negocios`).
 *
 * `nombre`, `colorPrimario` y `colorSecundario` son columnas NOT NULL: un `null` explicito es un
 * **400 con mensaje claro** (antes Prisma respondia 500). `undefined` = NO tocar (es lo que manda
 * el admin cuando el campo esta vacio). Los nullable (`telefono`, `direccion`, `email`, `logoUrl`,
 * `placeId`) aceptan `null` = borrar.
 */
export class ActualizarNegocioDto {
  @OpcionalSinNulo('El nombre no se puede vaciar: escribi un nombre de al menos 2 caracteres.')
  @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(30)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsUrl()
  logoUrl?: string;

  @HexColorObligatorio('El color primario', '#E11D48')
  colorPrimario?: string;

  @HexColorObligatorio('El color secundario', '#111827')
  colorSecundario?: string;

  @IsOptional() @IsString() @MaxLength(120)
  placeId?: string;
}
