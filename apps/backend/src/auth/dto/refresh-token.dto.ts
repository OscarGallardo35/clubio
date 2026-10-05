import { IsString } from 'class-validator';

/** Rotacion de refresh token del dueno. */
export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}
