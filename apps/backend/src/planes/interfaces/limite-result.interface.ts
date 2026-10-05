import { EstadoUso, RecursoLimitado } from '@prisma/client';

/**
 * Resultado de verificar un limite.
 *
 * limiteGracia = limiteBase + colchonGraciaDefault (USOS ABSOLUTOS, no %).
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