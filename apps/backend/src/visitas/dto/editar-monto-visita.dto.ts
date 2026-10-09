import { IsNumber, Max, Min } from 'class-validator';

/**
 * Fase 2: correccion del monto de una visita ya aprobada.
 *
 * El monto se puede subir o bajar; los PUNTOS se recalculan con la tasa vigente del club y el
 * saldo se ajusta por el delta. Bajar el monto cuando el cliente ya gasto esos puntos se rechaza
 * (400): no se clampea a 0, porque eso regalaria la diferencia sin que nadie lo vea.
 */
export class EditarMontoVisitaDto {
  @IsNumber() @Min(0) @Max(1000000)
  montoConsumido!: number;
}
