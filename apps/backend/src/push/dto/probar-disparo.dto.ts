import { IsString } from 'class-validator';

/** Prueba de un disparo: manda el push AHORA a un cliente puntual. */
export class ProbarDisparoDto {
  @IsString()
  clienteId!: string;
}
