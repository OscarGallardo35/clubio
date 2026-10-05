import { EstadoUso, RecursoLimitado } from '@prisma/client';

/**
 * Resultado de verificar un limite.
 *
 * limiteGracia = limiteBase + min(colchonGraciaDefault, ceil(limiteBase * 0.5))
 * (PROPORCIONAL con tope: 1->2 | 100->150 | 500->550 | 5000->5050).
 *   NORMAL      cantidad <= limiteBase
 *   ADVERTENCIA limiteBase < cantidad <= limiteGracia
 *   EXCEDIDO    cantidad > limiteGracia
 */
export interface LimiteResult {
  recurso: RecursoLimitado;
  permitido: boolean;
  estado: EstadoUso;
  cantidad: number;
  limiteBase: number;
  limiteGracia: number;
  /** limiteGracia - limiteBase (el colchon efectivo, capado). */
  colchonGracia?: number;
  usosRestantes: number;
  excedente: number;
  payPerUse: boolean;
  ilimitado: boolean;
  motivo: string;
}

export interface VerificarLimiteOpts {
  /** Sumar al contador actual (para verificar "crear 1 mas"). */
  incremento?: number;
  sucursalId?: string | null;
  periodo?: string;
}