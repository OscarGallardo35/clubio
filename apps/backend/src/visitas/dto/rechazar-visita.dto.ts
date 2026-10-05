import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RechazarVisitaDto {
  @IsOptional() @IsString() @MaxLength(300)
  motivo?: string;
}
