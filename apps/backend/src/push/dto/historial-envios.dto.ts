import { IsOptional, IsString } from 'class-validator';

/**
 * Filtros de `GET /push/envios/logs` (historial de ENVIOS de push del admin).
 *
 * Una fila de `EnvioPushLog` es un envio a UN destinatario en UN endpoint, asi que
 * aca entran todos los estados: `ENCOLADO` (todavia en la cola), `ENVIADO`,
 * `FALLIDO` (con `motivo` y `statusCode`), `SIN_SUSCRIPCION` y `SUPRIMIDO_EXCLUIDO`.
 */
export class HistorialEnviosDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  /** Solo los envios de esa campana (`CampanaMarketing.id`). */
  @IsOptional() @IsString() campanaId?: string;
  /** Solo los envios de ese disparo (`DisparoPush.id`). */
  @IsOptional() @IsString() disparoId?: string;
  /** 'ENCOLADO' | 'ENVIADO' | 'FALLIDO' | 'SIN_SUSCRIPCION' | 'SUPRIMIDO_EXCLUIDO'. */
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
}
