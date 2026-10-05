import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/** Alta de cliente desde la PWA Cliente. */
export class RegistrarClienteDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  nombre!: string;

  /** Se normaliza a E.164 en el servicio (rechaza 400 si es invalido). */
  @IsString()
  telefono!: string;

  @IsOptional()
  @IsBoolean()
  aceptaNotificaciones?: boolean;

  @IsString()
  negocioSlug!: string;

  /**
   * #2.11: sucursal donde se registra el cliente (la del QR). Si no viene, se usa
   * la principal. Se guarda en la TarjetaClienteSucursal.
   */
  @IsOptional()
  @IsString()
  sucursalSlug?: string;

  /** Compatibilidad con el header X-Sucursal-Slug. */
  @IsOptional()
  @IsString()
  sucursalId?: string;
}
