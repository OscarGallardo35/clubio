import {
  IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { ModoClientes, Plan } from '@prisma/client';

/**
 * Edicion de los datos BASE de un local (`PATCH /superadmin/locales/:negocioId`).
 *
 * A proposito NO incluye `slug`: es el identificador publico (links, QR, subdominio) y
 * cambiarlo rompe todo lo que ya esta impreso. Los colores de la tarjeta personalizada se
 * editan por `PATCH /locales/:negocioId/theme`.
 */
export class ActualizarLocalSuperAdminDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nombre?: string;
  @IsOptional() @IsEnum(Plan) plan?: Plan;
  @IsOptional() @IsHexColor() colorPrimario?: string;
  @IsOptional() @IsHexColor() colorSecundario?: string;
  /** `false` desactiva el local (deja de servirse por slug). */
  @IsOptional() @IsBoolean() activo?: boolean;

  @IsOptional() @IsString() @MaxLength(200) direccion?: string;
  @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsEnum(ModoClientes) modoClientes?: ModoClientes;

  /** Se escribe en `ConfiguracionClub` (es la fuente real del WhatsApp del local). */
  @IsOptional() @IsString() @MaxLength(40) numeroAtendiente?: string;
}
