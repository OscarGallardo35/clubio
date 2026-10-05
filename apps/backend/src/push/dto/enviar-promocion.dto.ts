import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EnviarPromocionDto {
  @IsString() @MinLength(1) @MaxLength(80)
  titulo!: string;

  @IsString() @MinLength(1) @MaxLength(500)
  cuerpo!: string;

  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  /** Segmento destino. */
  @IsOptional()
  @IsIn(['TODOS', 'VIP', 'REGULAR', 'NUEVO', 'INACTIVO'])
  segmento?: string;

  /** O enviar a clientes concretos. */
  @IsOptional() @IsArray() @IsString({ each: true })
  clienteIds?: string[];
}