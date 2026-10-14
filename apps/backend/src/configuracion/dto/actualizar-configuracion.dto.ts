import { Transform } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { ModoAsignacionPedidos, ModoFidelizacion, ModoPago, TipoPedido } from '@prisma/client';

/**
 * `''` = "NO tocar" (el campo se descarta antes de escribir); `null` EXPLICITO = BORRAR (el
 * valor queda en null). El admin del dueno manda `undefined` cuando un campo esta vacio, asi
 * que su semantica NO cambia; el panel de plataforma usa `null` para limpiar un valor.
 *
 * Se aplica SOLO a los campos de texto que el modelo admite en null / pueden quedar vacios.
 */
const VacioNoToca = () => Transform(({ value }) => (value === '' ? undefined : value));

export class ActualizarConfiguracionDto {
  @IsOptional() @IsEnum(ModoFidelizacion) modoFidelizacion?: ModoFidelizacion;
  @IsOptional() @IsInt() @Min(1) @Max(100) sellosParaPremio?: number;
  @IsOptional() @IsString() @MaxLength(160) premioTexto?: string;
  /** Puntos que cuesta el premio de puntos (el de sellos es `sellosParaPremio`). */
  @IsOptional() @IsInt() @Min(1) @Max(100000) premioPorPuntos?: number;
  /** Tasa del programa por puntos: cuantos puntos por cada $1000 de consumo. */
  @IsOptional() @IsInt() @Min(1) @Max(1000) puntosPorMil?: number;
  /** Texto del premio de puntos (el de sellos es `premioTexto`). */
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(160) premioTextoPuntos?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) sellosBienvenida?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) limiteVisitasPorDia?: number;
  @IsOptional() @IsInt() @Min(0) @Max(72) horasMinimasEntreVisitas?: number;
  @IsOptional() @IsBoolean() requiereValidacionEmpleado?: boolean;
  @IsOptional() @IsBoolean() permiteRegaloManual?: boolean;
  @IsOptional() @IsBoolean() mostrarResenaPostVisita?: boolean;
  @IsOptional() @IsBoolean() menuActivo?: boolean;
  /** Mensaje que ve el cliente en su tarjeta. Faltaba en el DTO (estaba solo en el modelo). */
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(500) mensajeBienvenida?: string | null;

  @IsOptional() @IsArray() tiposPedidoHabilitados?: TipoPedido[];
  @IsOptional() @IsArray() modosPagoHabilitados?: ModoPago[];
  /**
   * Grillas semanales de horarios (JSON). Solo se valida que sean objeto: la forma fina
   * (dias `lun..dom`, rangos `{desde,hasta}` en HH:mm) la valida `validarGrilla` en el
   * servicio, que ademas traduce `null`/`{}` a "sin horarios" (= siempre abierto).
   */
  @IsOptional() @IsObject() horariosAtencion?: Record<string, unknown> | null;
  @IsOptional() @IsObject() horariosDelivery?: Record<string, unknown> | null;
  @IsOptional() @IsEnum(ModoPago) modoPagoPorDefecto?: ModoPago;
  @IsOptional() @IsEnum(TipoPedido) tipoPedidoPorDefecto?: TipoPedido;
  @IsOptional() @IsEnum(ModoAsignacionPedidos) modoAsignacionPedidos?: ModoAsignacionPedidos;
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(40) numeroAtendiente?: string | null;
  /**
   * Fuente PRIMARIA del WhatsApp del local es `numeroAtendiente` del club; este switch decide
   * si el numero PROPIO de una sucursal (`Sucursal.numeroAtendiente`) lo reemplaza para esa
   * sucursal. `false` (default) = manda el del club; `true` = manda el de la sucursal (con
   * fallback al del club). Ver `SucursalResolverService.resolverNumeroAtendiente`.
   */
  @IsOptional() @IsBoolean() usarNumeroAtendienteDistinto?: boolean;

  @IsOptional() @VacioNoToca() @IsString() @MaxLength(120) transferenciaAlias?: string | null;
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(40) transferenciaCbu?: string | null;
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(120) transferenciaTitular?: string | null;
  @IsOptional() @VacioNoToca() @IsString() @MaxLength(120) transferenciaBanco?: string | null;
  @IsOptional() @VacioNoToca() @IsString() linkMercadoPago?: string | null;

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
