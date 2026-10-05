import { Plan } from '@prisma/client';

/** Lo que deja el PlanGuard en la request. */
export interface FeatureCheck {
  plan: Plan;
  feature: string;
  habilitada: boolean;
  motivo?: string;
}

/** Forma minima de una PlanFeature cacheada. */
export interface FeatureCacheada {
  feature: string;
  habilitada: boolean;
  limite: number | null;
}