import { IsEmail, IsString, MinLength } from 'class-validator';

/** Login del dueno por email + password (puede requerir 2FA). */
export class LoginDuenoDto {
  @IsEmail({}, { message: 'Email invalido' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password!: string;

  /** Slug del negocio (resuelto por subdominio/header). */
  @IsString()
  negocioSlug!: string;
}
