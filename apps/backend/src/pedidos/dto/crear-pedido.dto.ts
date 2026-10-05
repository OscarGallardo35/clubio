import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ModoPago, TipoPedido } from '@prisma/client';

export class ItemPedidoInputDto {
  @IsString()
  itemId!: string;

  @IsInt() @Min(1) @Max(99)
  cantidad!: number;

  @IsOptional() @IsString() @MaxLength(200)
  notas?: string;

  /**
   * Se acepta para no romper al cliente, pero el backend IGNORA el precio y lo
   * recalcula desde la DB (evita manipulacion del carrito).
   */
  @IsOptional()
  precio?: number;

  /** Reservado para el #2.7 (hoy se ignora). */
  @IsOptional()
  @IsArray()
  modificadores?: Array<{ grupoId: string; opcionId: string }>;
}

export class CrearPedidoDto {
  @IsEnum(TipoPedido)
  tipo!: TipoPedido;

  @IsEnum(ModoPago)
  modoPago!: ModoPago;

  @IsString() @MinLength(2) @MaxLength(120)
  nombreCliente!: string;

  /** Se normaliza a E.164 antes de usarse. */
  @IsString() @MinLength(6) @MaxLength(30)
  telefono!: string;

  /** Requerido si tipo = DELIVERY. */
  @IsOptional() @IsString() @MaxLength(300)
  direccion?: string;

  /** Requerido si tipo = MESA (o su equivalente en `origen`). */
  @IsOptional() @IsString() @MaxLength(20)
  mesa?: string;

  @IsOptional() @IsString() @MaxLength(60)
  origen?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoInputDto)
  items!: ItemPedidoInputDto[];

  @IsOptional() @IsString() @MaxLength(500)
  notas?: string;

  // --- resolucion de sucursal (ademas de la principal) ---
  @IsOptional() @IsString()
  sucursalId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  sucursalSlug?: string;
}