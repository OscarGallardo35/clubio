import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { GeneroCliente } from '@prisma/client';

/**
 * `PATCH /api/auth/cliente/perfil` (autenticado como CLIENTE).
 *
 * El cliente guarda SOLO lo suyo (el id sale del token, nunca del body).
 * Semantica de cada campo, siguiendo la convencion del repo:
 *  - ausente / `''`  = NO tocar;
 *  - `null` explicito = BORRAR (queda en null);
 *  - valor           = guardar (registra el consentimiento).
 *
 * `rechazar: true` = "no quiero responder": marca `perfiladoRechazado` y NO guarda el resto.
 * La validacion de fondo (fecha valida, no futura, edad >= 13) vive en
 * `parseFechaNacimientoPerfil` porque tiene que correr igual desde el panel del dueño.
 */
export class ActualizarPerfilClienteDto {
  /** Fecha de nacimiento: `'YYYY-MM-DD'` o ISO. `null` la borra. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @MaxLength(40)
  fechaNacimiento?: string | null;

  /** Genero autodeclarado. `null` lo borra. Valor fuera del enum => 400. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(GeneroCliente)
  genero?: GeneroCliente | null;

  /** true = no quiere responder. Nunca mas se le pregunta. No bloquea un guardado posterior. */
  @IsOptional()
  @IsBoolean()
  rechazar?: boolean;

  /**
   * true = se le mostro el pedido y no respondio: sella `perfiladoOmitidoEn` (para que la PWA
   * no insista en cada visita). Las tres claves del contrato congelado siguen siendo
   * `fechaNacimiento` / `genero` / `rechazar`; esta es ADITIVA y opcional.
   */
  @IsOptional()
  @IsBoolean()
  omitido?: boolean;
}
