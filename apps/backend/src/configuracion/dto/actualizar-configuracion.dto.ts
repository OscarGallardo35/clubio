import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { ModoAsignacionPedidos, ModoFidelizacion, ModoPago, TipoPedido } from '@prisma/client';

export class ActualizarConfiguracionDto {
  @IsOptional() @IsEnum(ModoFidelizacion) modoFidelizacion?: ModoFidelizacion;
  @IsOptional() @IsInt() @Min(1) @Max(100) sellosParaPremio?: number;
  @IsOptional() @IsString() @MaxLength(160) premioTexto?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) sellosBienvenida?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) limiteVisitasPorDia?: number;
  @IsOptional() @IsInt() @Min(0) @Max(72) horasMinimasEntreVisitas?: number;
  @IsOptional() @IsBoolean() requiereValidacionEmpleado?: boolean;
  @IsOptional() @IsBoolean() permiteRegaloManual?: boolean;
  @IsOptional() @IsBoolean() mostrarResenaPostVisita?: boolean;
  @IsOptional() @IsBoolean() menuActivo?: boolean;
  /** Mensaje que ve el cliente en su tarjeta. Faltaba en el DTO (estaba solo en el modelo). */
  @IsOptional() @IsString() @MaxLength(500) mensajeBienvenida?: string;

  @IsOptional() @IsArray() tiposPedidoHabilitados?: TipoPedido[];
  @IsOptional() @IsArray() modosPagoHabilitados?: ModoPago[];
  @IsOptional() @IsEnum(ModoPago) modoPagoPorDefecto?: ModoPago;
  @IsOptional() @IsEnum(TipoPedido) tipoPedidoPorDefecto?: TipoPedido;
  @IsOptional() @IsEnum(ModoAsignacionPedidos) modoAsignacionPedidos?: ModoAsignacionPedidos;
  @IsOptional() @IsString() @MaxLength(40) numeroAtendiente?: string;

  @IsOptional() @IsString() @MaxLength(120) transferenciaAlias?: string;
  @IsOptional() @IsString() @MaxLength(40) transferenciaCbu?: string;
  @IsOptional() @IsString() @MaxLength(120) transferenciaTitular?: string;
  @IsOptional() @IsString() @MaxLength(120) transferenciaBanco?: string;
  @IsOptional() @IsString() linkMercadoPago?: string;

  @IsOptional() @IsBoolean() upsellActivo?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10) upsellMaxSugerencias?: number;

  @IsOptional() @IsBoolean() turnosActivos?: boolean;
  @IsOptional() @IsBoolean() checkinObligatorio?: boolean;
  @IsOptional() @IsBoolean() duplicarSemanaAuto?: boolean;

  @IsOptional() @IsBoolean() pushInactividad3Dias?: boolean;
  @IsOptional() @IsBoolean() pushCumpleanos?: boolean;
  @IsOptional() @IsBoolean() pushPremioPorVencer?: boolean;
  @IsOptional() @IsBoolean() pushAUnoDelPremio?: boolean;
  @IsOptional() @IsBoolean() pushInactivos30Dias?: boolean;
}
