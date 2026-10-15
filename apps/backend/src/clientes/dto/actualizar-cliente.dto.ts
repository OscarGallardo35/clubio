import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EtiquetaCliente, GeneroCliente } from '@prisma/client';

export class ActualizarClienteDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @IsOptional() @IsEnum(EtiquetaCliente)
  etiqueta?: EtiquetaCliente;

  @IsOptional() @IsBoolean()
  aceptaNotificaciones?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  notasInternas?: string;

  /**
   * PERFILADO PROGRESIVO: el dueno tambien carga/corrige la fecha de nacimiento (el caso tipico:
   * el cliente la dio en el mostrador). `''` = no tocar; `null` = borrar.
   * La validacion de fondo (valida, no futura, edad >= 13, no mas de 100 años) corre en el
   * servicio con la MISMA funcion que usa la PWA del cliente (`parseFechaNacimientoPerfil`).
   */
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString() @MaxLength(40)
  fechaNacimiento?: string | null;

  /** Genero autodeclarado. `null` lo borra; un valor fuera del enum es 400. */
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(GeneroCliente)
  genero?: GeneroCliente | null;
}
