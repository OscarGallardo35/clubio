import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsIn, IsObject, IsOptional, IsString, Length, Matches, MaxLength, MinLength,
  ValidateNested,
} from 'class-validator';
import { RolEmpleado } from '@prisma/client';
import { CrearItemCartaDto } from '../../carta/dto/crear-item-carta.dto';

/**
 * Plantillas disponibles de la FABRICA DE DEMOS (`POST /locales/:negocioId/provisionar`).
 * Los items/config/theme de cada una viven en `../plantillas-demo.ts`.
 */
export const PLANTILLAS_DEMO = ['lomiteria', 'bar', 'cafeteria', 'basica'] as const;
export type PlantillaDemoNombre = (typeof PLANTILLAS_DEMO)[number];

/** Empleado de ejemplo que crea el provisioning (dueno con email+password, encargado con PIN). */
export class EmpleadoDemoDto {
  @IsString() @MinLength(2) @MaxLength(120)
  nombre!: string;

  @IsEnum(RolEmpleado)
  rol!: RolEmpleado;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  /** Se guarda hasheado con bcrypt (el hash NUNCA sale en la respuesta). */
  @IsOptional() @IsString() @MinLength(6) @MaxLength(120)
  password?: string;

  @IsOptional() @IsString() @Length(4, 8) @Matches(/^\d+$/, { message: 'El PIN debe ser numerico' })
  pin?: string;
}

/**
 * Cuerpo del provisioning. Todo es opcional menos la plantilla: lo que no se manda se toma
 * de la plantilla, y lo que se manda PISA a la plantilla.
 *
 *  - `config`  — campos de `ActualizarConfiguracionDto` (modo, sellos, premio, numero
 *                de WhatsApp, etc.). Se valida/filtra contra ese DTO: una clave
 *                desconocida se descarta y un valor invalido da 400.
 *  - `theme`   — JSON del theme de la tarjeta (`TenantTheme` de @repo/types).
 *  - `carta`   — items (mismo shape que `CrearItemCartaDto`).
 *  - `empleados` — empleados de ejemplo a crear en vez de los de la plantilla.
 */
export class ProvisionarLocalSuperAdminDto {
  @IsIn(PLANTILLAS_DEMO as unknown as string[], { message: 'Plantilla invalida' })
  plantilla!: PlantillaDemoNombre;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;

  @IsOptional() @IsObject()
  theme?: Record<string, unknown>;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CrearItemCartaDto)
  carta?: CrearItemCartaDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => EmpleadoDemoDto)
  empleados?: EmpleadoDemoDto[];
}
