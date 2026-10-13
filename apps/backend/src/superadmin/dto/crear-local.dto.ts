import { Transform } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';
import { ModoClientes, Plan } from '@prisma/client';

/**
 * Alta de un local desde el panel de PLATAFORMA (`POST /superadmin/locales`).
 *
 * Crea el `Negocio` (activo) + su `Sucursal` principal (`centro`, activa, esPrincipal) y
 * una `ConfiguracionClub` con defaults: el local queda navegable aunque todavia no se lo
 * haya provisionado con una plantilla de demo.
 *
 * `slug` es el identificador publico (path de la PWA Cliente, `X-Tenant-Slug`): se normaliza
 * a minusculas y se valida el mismo formato que usan los locales reales.
 */
export class CrearLocalSuperAdminDto {
  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  /** Path publico del local. Unico GLOBAL (columna `Negocio.slug`). */
  @IsString() @MinLength(2) @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El slug solo admite minusculas, numeros y guiones (ej: mi-local)',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  slug!: string;

  /** Plan comercial. Default PRO: un local demo necesita `menu` y sin limites de carta. */
  @IsOptional() @IsEnum(Plan)
  plan?: Plan;

  @IsOptional() @IsHexColor() colorPrimario?: string;
  @IsOptional() @IsHexColor() colorSecundario?: string;

  /** WhatsApp del local (`ConfiguracionClub.numeroAtendiente` + `Sucursal.numeroAtendiente`). */
  @IsOptional() @IsString() @MaxLength(40)
  numeroAtendiente?: string;

  @IsOptional() @IsString() @MaxLength(200) direccion?: string;
  @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsEnum(ModoClientes) modoClientes?: ModoClientes;
  @IsOptional() @IsBoolean() activo?: boolean;
}
