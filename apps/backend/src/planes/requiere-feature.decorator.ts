import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'requiere_feature';

/**
 * Marca un endpoint como sujeto al plan del negocio.
 * El PlanGuard SOLO actua cuando encuentra este decorador.
 *
 * El string es el nombre de la feature tal como esta en PlanFeature:
 * 'menu', 'pedidos', 'upsell', 'turnos', 'checkin', 'crm', 'push', ...
 */
export const RequiereFeature = (feature: string) => SetMetadata(FEATURE_KEY, feature);