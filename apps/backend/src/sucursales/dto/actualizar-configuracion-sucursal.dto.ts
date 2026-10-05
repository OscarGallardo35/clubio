import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min,
} from 'class-validator';
import { ModoPago, TipoPedido } from '@prisma/client';

/**
 * Todos los campos son OPCIONALES. Un campo ausente (o null) hereda el global.
 * Un ARRAY VACIO tambien hereda (ver configEfectiva): [] significa "sin override",
 * no "ningun tipo de pedido habilitado".
 */
export class ActualizarConfiguracionSucursalDto {
  @IsOptional() @IsString()
  premioTexto?: string | null;

  @IsOptional() @IsInt() @Min(1)
  sellosParaPremio?: number | null;

  @IsOptional() @IsInt() @Min(0)
  sellosBienvenida?: number | null;

  @IsOptional() @IsInt() @Min(0)
  limiteVisitasPorDia?: number | null;

  @IsOptional() @IsInt() @Min(0)
  horasMinimasEntreVisitas?: number | null;

  @IsOptional() @IsArray() @IsEnum(TipoPedido, { each: true })
  tiposPedidoHabilitados?: TipoPedido[];

  @IsOptional() @IsArray() @IsEnum(ModoPago, { each: true })
  modosPagoHabilitados?: ModoPago[];

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  costoEnvio?: number | null;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  pedidoMinimoDelivery?: number | null;

  @IsOptional() @IsString()
  zonaEntrega?: string | null;

  @IsOptional() @IsString()
  transferenciaAlias?: string | null;

  @IsOptional() @IsString()
  transferenciaCbu?: string | null;

  @IsOptional() @IsString()
  transferenciaTitular?: string | null;

  @IsOptional() @IsString()
  transferenciaBanco?: string | null;
}