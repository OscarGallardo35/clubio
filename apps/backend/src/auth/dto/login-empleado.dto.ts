import { IsString, Length, Matches } from 'class-validator';

/** Login de staff por PIN. El negocio se resuelve por slug (subdominio). */
export class LoginEmpleadoDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,60}$/, { message: 'negocioSlug invalido' })
  negocioSlug!: string;

  @IsString()
  @Length(4, 8, { message: 'El PIN debe tener entre 4 y 8 digitos' })
  @Matches(/^\d+$/, { message: 'El PIN debe ser numerico' })
  pin!: string;
}
