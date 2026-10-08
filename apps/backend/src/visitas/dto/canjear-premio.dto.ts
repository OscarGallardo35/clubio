import { IsIn, IsOptional, IsString } from 'class-validator';

/** Que premio se canjea. No hay canje mixto: cada uno tiene su umbral y su saldo. */
export const TIPOS_CANJE = ['SELLOS', 'PUNTOS'] as const;
export type TipoCanje = (typeof TIPOS_CANJE)[number];

export class CanjearPremioDto {
  /** El cliente al que se le canjea (el staff lo tiene en pantalla). */
  @IsString()
  clienteId!: string;

  @IsIn(TIPOS_CANJE as unknown as string[])
  tipo!: TipoCanje;

  /** Por defecto, la sucursal del empleado que canjea. */
  @IsOptional() @IsString()
  sucursalId?: string;
}
