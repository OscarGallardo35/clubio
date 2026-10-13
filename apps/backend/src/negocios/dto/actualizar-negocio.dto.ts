import { IsHexColor, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { OpcionalSinNulo } from '../../common/validators/opcional-sin-nulo.validator';

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

  @OpcionalSinNulo('El color primario no se puede vaciar: elegi otro color en hex (ej. #E11D48).')
  @IsHexColor({ message: 'El color primario tiene que ser un hex de 6 digitos (ej. #E11D48).' })
  colorPrimario?: string;

  @OpcionalSinNulo('El color secundario no se puede vaciar: elegi otro color en hex (ej. #111827).')
  @IsHexColor({ message: 'El color secundario tiene que ser un hex de 6 digitos (ej. #111827).' })
  colorSecundario?: string;

  @IsOptional() @IsString() @MaxLength(120)
  placeId?: string;
}
