import { IsString, MaxLength, MinLength } from 'class-validator';

export class RechazarPedidoDto {
  @IsString() @MinLength(10) @MaxLength(300)
  motivo!: string;
}