import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EtiquetaCliente } from '@prisma/client';
import { PaginationQuery } from '../../common/utils/pagination.util';

export class FiltrarClientesDto implements PaginationQuery {
  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;

  @IsOptional() @IsEnum(EtiquetaCliente)
  etiqueta?: EtiquetaCliente;

  @IsOptional() @IsString() @MaxLength(80)
  search?: string;

  /** Filtra por sucursal (si el usuario es privilegiado). */
  @IsOptional() @IsString()
  sucursalId?: string;
}
