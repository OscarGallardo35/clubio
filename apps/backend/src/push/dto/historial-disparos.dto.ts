import { IsOptional, IsString } from 'class-validator';

/**
 * Filtros de `GET /push/disparos/logs` (historial de ejecuciones de los disparos).
 *
 * Un `DisparoPushLog` es la fila-candado de idempotencia: existe una por
 * (disparo, evento), se haya enviado o no. Por eso el historial muestra tambien
 * los OMITIDOS (limite / duplicado / sin suscripcion) y no solo los enviados.
 */
export class HistorialDisparosDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsString() disparoId?: string;
  /** 'ENVIADO' | 'OMITIDO_LIMITE' | 'OMITIDO_DUP' | 'OMITIDO_SIN_SUSCRIPCION'. */
  @IsOptional() @IsString() accion?: string;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
}
