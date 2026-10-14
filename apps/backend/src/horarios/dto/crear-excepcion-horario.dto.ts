import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Alta de un feriado / cierre temporal. Fechas en hora ARGENTINA (YYYY-MM-DD). */
export class CrearExcepcionHorarioDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desdeFecha debe ser YYYY-MM-DD' })
  desdeFecha!: string;

  /** Inclusive. Si falta, es un cierre de un solo dia. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hastaFecha debe ser YYYY-MM-DD' })
  hastaFecha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  motivo?: string;

  /** Vacío/null = todas las sucursales. */
  @IsOptional()
  @IsString()
  sucursalId?: string;
}
