import { Transform } from 'class-transformer';
import { IsBooleanString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Valores del enum `Plan` de Prisma (facturacion). */
export const PLANES = ['FREE', 'BASIC', 'PRO'] as const;

/**
 * Filtros del listado de locales (GET /superadmin/locales).
 *
 * El buscador es SERVER-SIDE: la plataforma puede tener cientos de locales y no
 * tiene sentido mandarlos todos al cliente para filtrar en memoria. La PWA le
 * pasa lo que escribe el operador y el backend resuelve el `contains`.
 */
export class ListarLocalesSuperAdminDto {
  /** Busca por nombre o slug (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  /** Filtra por plan (FREE | BASIC | PRO) — validado contra el enum, no contra texto libre. */
  @IsOptional()
  @IsIn(PLANES as unknown as string[], { message: 'Plan invalido' })
  plan?: string;

  /** 'true' | 'false' — llega como string por query, por eso `IsBooleanString`. */
  @IsOptional()
  @IsBooleanString()
  activo?: string;
}
