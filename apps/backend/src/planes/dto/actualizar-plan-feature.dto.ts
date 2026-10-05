import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ActualizarPlanFeatureDto {
  @IsOptional() @IsBoolean()
  habilitada?: boolean;

  /** null = ilimitado. */
  @IsOptional() @IsInt() @Min(0)
  limite?: number | null;
}