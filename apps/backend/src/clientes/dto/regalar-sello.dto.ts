import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RegalarSelloDto {
  @IsOptional() @IsInt() @Min(1) @Max(100)
  sellos?: number;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  puntos?: number;

  @IsOptional() @IsString() @MaxLength(200)
  motivo?: string;
}
