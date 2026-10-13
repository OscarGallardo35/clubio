import {
  IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { ModoClientes, Plan } from '@prisma/client';
import { OpcionalSinNulo } from '../../common/validators/opcional-sin-nulo.validator';

/**
 * Edicion de los datos BASE de un local (`PATCH /superadmin/locales/:negocioId`).
 *
 * A proposito NO incluye `slug`: es el identificador publico (links, QR, subdominio) y
 * cambiarlo rompe todo lo que ya esta impreso. Los colores de la tarjeta personalizada se
 * editan por `PATCH /locales/:negocioId/theme`.
 *
 * Limpieza de valores: `undefined` = NO tocar (el admin del dueno manda `undefined` cuando un
 * campo esta vacio). Los campos que en la DB son NOT NULL (`nombre`, `plan`, `colorPrimario`,
 * `colorSecundario`, `activo`, `modoClientes`) usan `OpcionalSinNulo`: un `null` explicito es un
 * **400 con mensaje claro**, nunca un 500 de Prisma. Los nullable (`direccion`, `telefono`,
 * `email`, `logoUrl` y `numeroAtendiente`) SI aceptan `null` explicito = borrar.
 */
export class ActualizarLocalSuperAdminDto {
  @OpcionalSinNulo('El nombre no se puede vaciar: escribi un nombre de al menos 2 caracteres.')
  @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @OpcionalSinNulo('El plan no se puede vaciar: elegi FREE o PRO.')
  @IsEnum(Plan)
  plan?: Plan;

  @OpcionalSinNulo('El color primario no se puede vaciar: elegi otro color en hex (ej. #E11D48).')
  @IsHexColor({ message: 'El color primario tiene que ser un hex de 6 digitos (ej. #E11D48).' })
  colorPrimario?: string;

  @OpcionalSinNulo('El color secundario no se puede vaciar: elegi otro color en hex (ej. #111827).')
  @IsHexColor({ message: 'El color secundario tiene que ser un hex de 6 digitos (ej. #111827).' })
  colorSecundario?: string;

  /** `false` desactiva el local (deja de servirse por slug). */
  @OpcionalSinNulo('activo no se puede vaciar: usa true o false.')
  @IsBoolean()
  activo?: boolean;

  @IsOptional() @IsString() @MaxLength(200) direccion?: string;
  @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;

  @OpcionalSinNulo('El modo de clientes no se puede vaciar: elegi un valor valido.')
  @IsEnum(ModoClientes)
  modoClientes?: ModoClientes;

  /**
   * Se escribe en `ConfiguracionClub` (es la fuente real del WhatsApp del local).
   *
   * Semantica de limpieza (el vacio NO cambia): ausente o `''` = NO tocar; `null`
   * EXPLICITO = borrar el valor (queda en null).
   */
  @IsOptional() @IsString() @MaxLength(40) numeroAtendiente?: string | null;
}
