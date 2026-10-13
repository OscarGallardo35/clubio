import { IsString } from 'class-validator';

/** Rotacion del refresh token del super-admin (mismo patron que el del dueno). */
export class RefreshSuperAdminDto {
  @IsString()
  refreshToken!: string;
}
