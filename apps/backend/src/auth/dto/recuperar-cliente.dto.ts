import { IsString } from 'class-validator';

/** Recupera la sesion de un cliente ya registrado, por telefono. */
export class RecuperarClienteDto {
  @IsString()
  telefono!: string;

  @IsString()
  negocioSlug!: string;
}
