import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SolicitarVisitaDto {
  /** Sucursal explicita (opcional). Si no viene, se usa la principal. */
  @IsOptional() @IsString()
  sucursalId?: string;

  /** Slug de sucursal (el QR fisico puede venir con ?sucursal=norte). */
  @IsOptional() @IsString() @MaxLength(60)
  sucursalSlug?: string;

  /** De donde viene la solicitud: 'qr_menu' | 'qr_club' | 'pwa'. */
  @IsOptional() @IsString() @MaxLength(40)
  origen?: string;
}
