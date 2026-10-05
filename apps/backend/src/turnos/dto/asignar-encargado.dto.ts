import { IsOptional, IsString, Matches } from 'class-validator';

export class AsignarEncargadoDto {
  @IsString()
  empleadoId!: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha!: string;

  @IsOptional() @IsString()
  sucursalId?: string;
}