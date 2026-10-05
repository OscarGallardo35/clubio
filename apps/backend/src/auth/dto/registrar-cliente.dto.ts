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
}
