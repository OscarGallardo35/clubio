import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckinDto {
  @IsOptional() @IsString() @MaxLength(300)
  notas?: string;

  /** Punto de venta / tablet (queda en el registro). */
  @IsOptional() @IsString() @MaxLength(60)
  origen?: string;
}