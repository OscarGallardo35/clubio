import { TipoDisparo } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de un DisparoPush (automatizacion de push).
 *
 * `config` es libre por tipo (el admin arma el objeto):
 *   COMPRA      { estado:'ENTREGADO', cadaNCompras:1 }
 *   SELLOS      { cuando:'CADA_SELLO'|'FALTAN_N', n:1 }
 *   DIA         { dia:'FRIDAY'|'2026-10-15', hora:'18:00' }
 *   INACTIVIDAD { dias:30 }
 *   BIENVENIDA  {}
 *   MANUAL      {}
 */
export class CrearDisparoDto {
  @IsString() @MinLength(2) @MaxLength(100)
  nombre!: string;

  @IsEnum(TipoDisparo)
  tipo!: TipoDisparo;

  @IsString()
  plantillaId!: string;

  @IsOptional() @IsBoolean()
  activa?: boolean;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;

  /** { sellos?:number, puntos?:number } -> acredita saldo ADEMAS de mandar el push. */
  @IsOptional() @IsObject()
  regalo?: Record<string, unknown>;

  /** { porDia?:number, porMes?:number } */
  @IsOptional() @IsObject()
  limitePorCliente?: Record<string, unknown>;
}
