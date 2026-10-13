import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Login del super-admin de la plataforma (panel del operador).
 *
 * A diferencia del login del dueno NO pide `negocioSlug`: el super-admin no
 * pertenece a ningun negocio. Su identidad es global (`SuperAdmin.email @unique`).
 */
export class LoginSuperAdminDto {
  @IsEmail({}, { message: 'Email invalido' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'La contrasena debe tener al menos 6 caracteres' })
  password!: string;
}
