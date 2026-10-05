import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ResponderResenaDto {
  @IsString() @MinLength(1) @MaxLength(1000)
  texto!: string;
}

export class FiltrarResenasDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  /** Solo las que tienen esta cantidad de estrellas. */
  @IsOptional() @IsInt() @Min(1) @Max(5)
  estrellas?: number;
  @IsOptional() @IsString() respondida?: string;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
}