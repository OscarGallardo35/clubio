import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { QueryBool } from '../../common/utils/query.util';

export class FiltrarSucursalesDto {
  // Los query params LLEGAN COMO STRING (ver TROUBLESHOOTING). QueryBool compara
  // el texto: @Type(() => Boolean) convertiria "false" en true.
  @IsOptional() @QueryBool() @IsBoolean()
  activa?: boolean;

  @IsOptional() @QueryBool() @IsBoolean()
  esPrincipal?: boolean;

  @IsOptional() @IsString() @MaxLength(80)
  busqueda?: string;

  @IsOptional() @IsIn(['nombre', 'creadoEn', 'empleadosActivos', 'pedidosDelMes'])
  ordenarPor?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  orden?: 'asc' | 'desc';
}