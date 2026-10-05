import { IsBoolean, IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QueryBool } from '../../common/utils/query.util';

/** Mismos campos que crear, todos opcionales y SIN slug (el slug no se cambia). */
export class ActualizarSucursalDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(40)
  numeroAtendiente?: string;

  @IsOptional() @IsHexColor()
  colorPrimario?: string;

  @IsOptional() @IsHexColor()
  colorSecundario?: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;
}

export class EliminarSucursalDto {
  /** Reasigna empleados a la principal y cancela los pedidos activos. */
  @IsOptional() @QueryBool() @IsBoolean()
  force?: boolean;
}