import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ClavesPushDto {
  @IsString() p256dh!: string;
  @IsString() auth!: string;
}

export class SuscribirPushDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ClavesPushDto)
  keys!: ClavesPushDto;

  @IsOptional() @IsString()
  userAgent?: string;
}