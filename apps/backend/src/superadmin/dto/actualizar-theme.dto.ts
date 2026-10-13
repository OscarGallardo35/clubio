import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Theme de la tarjeta del cliente (`PATCH /locales/:negocioId/theme`).
 *
 * El JSON vive en `Negocio.theme` y lo consume la PWA Cliente (`getTheme()` de @repo/types
 * rellena los huecos con neutros). Por eso todos los campos son opcionales: se hace MERGE
 * superficial sobre el theme existente y lo que no viene queda como estaba.
 */
export class ActualizarThemeSuperAdminDto {
  /** `{ bg, accent, brandDark, text, textMuted }` (hex o color CSS valido). */
  @IsOptional() @IsObject()
  colores?: Record<string, string>;

  /** `{ rotacionBase?, forma? }`. */
  @IsOptional() @IsObject()
  sello?: Record<string, unknown>;

  /** Path publico de la imagen de fondo (ej: `/tenants/<slug>/bg.webp`). `null` = solo color. */
  @IsOptional() @IsString() @MaxLength(500)
  imagenFondo?: string | null;

  /** `false` oculta la barra de puntos en modo HIBRIDO. */
  @IsOptional() @IsBoolean()
  mostrarPuntos?: boolean;
}
