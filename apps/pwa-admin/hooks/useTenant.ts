'use client';

import { useParams, usePathname } from 'next/navigation';
import { DEFAULT_TENANT } from '@/lib/constants';
import { tenantDePath } from '@/lib/tenant';

/**
 * Tenant de la pantalla actual, para armar links.
 *
 * Sale del param `[tenant]` de la ruta; si el componente no esta bajo `[tenant]` (por ejemplo un
 * helper reusado), se cae al primer segmento del pathname. Nunca a `window`: el primer render tiene
 * que coincidir con el del servidor.
 */
export function useTenant(): string {
  const params = useParams<{ tenant?: string }>();
  const pathname = usePathname();
  const delParam = typeof params?.tenant === 'string' ? params.tenant : null;
  return delParam ?? tenantDePath(pathname) ?? DEFAULT_TENANT;
}
