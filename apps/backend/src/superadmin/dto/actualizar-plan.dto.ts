import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { Plan } from '@prisma/client';

/**
 * Body de `PATCH /superadmin/locales/:negocioId/plan`.
 *
 * Es la puerta HTTP del MOTOR de planes que ya existe (`plan.service`): no define un
 * contrato paralelo, solo valida la forma y delega. Los tres bloques son opcionales y
 * aditivos; mandar `{}` no toca nada (devuelve lo vigente).
 *
 *  - `plan`             — cambia `Negocio.plan` (el plan efectivo puede venir de la
 *                         Suscripcion; ver `PlanService.planDeNegocio`).
 *  - `features`         — `{<clave>: {habilitada, limite?}}`. La CLAVE se valida contra el
 *                         catalogo (`CLAVES_FEATURES`) y `limite` es entero >= 0 o null
 *                         (null = ilimitado) en el servicio. Setea la fila del PLAN.
 *  - `payPerUseActivo`  — activa/apaga el pay-per-use del negocio.
 *
 * `features` se tipa como objeto libre a proposito: la validacion fina (clave conocida y
 * tipos) vive en `PlanService.aplicarPlanNegocio`, que es quien conoce el catalogo.
 */
export class ActualizarPlanLocalDto {
  /** Enum real de Prisma: FREE | BASIC | PRO (mismo criterio que `ActualizarLocalSuperAdminDto`). */
  @IsOptional() @IsEnum(Plan)
  plan?: Plan;

  @IsOptional() @IsObject()
  features?: Record<string, { habilitada: boolean; limite?: number | null }>;

  @IsOptional() @IsBoolean()
  payPerUseActivo?: boolean;
}
