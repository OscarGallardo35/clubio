import { IsString, Length, Matches } from 'class-validator';

/** Segundo paso del login del dueno: valida el codigo TOTP. */
export class Verificar2FaDto {
  /** Token temporal emitido por /auth/dueno/login cuando requiere2FA = true. */
  @IsString()
  challengeToken!: string;

  @IsString()
  @Length(6, 6, { message: 'El codigo debe tener 6 digitos' })
  @Matches(/^\d{6}$/, { message: 'El codigo debe ser numerico de 6 digitos' })
  codigo!: string;
}
