'use client';

import * as React from 'react';
import { Skeleton } from '@repo/ui';
import { Sidebar } from '@/components/Sidebar';
import { BarraSuperadminMobile } from '@/components/BarraSuperadminMobile';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';

/**
 * Layout de las pantallas con sesion (todo menos /login).
 *
 * OJO — ACÁ NO HAY MIDDLEWARE, y es a proposito (a diferencia de las otras PWAs).
 * La cookie de sesion `superadmin_token` es HOST-ONLY: la emite el host de la API
 * (`api.clubio.lat`) y el navegador solo se la manda a ESE host. El host de este panel
 * no la ve, asi que un middleware del edge no puede decidir nada sobre la sesion (en
 * las otras PWAs si puede, porque su cookie es de `.clubio.lat`). El gate es
 * CLIENT-SIDE: `useSuperAdmin` sondea `GET /superadmin/auth/me` y, con 401, manda al
 * login; mientras tanto se muestra el skeleton de abajo (nunca el panel vacio).
 *
 * Estado "resolviendo sesion": obligatorio. Sin el, el primer render entra en "no
 * autenticado" (la request todavia no volvio) y el operador ve un parpadeo de login.
 *
 * Desktop: barra lateral fija a la izquierda. `main` lleva `min-w-0`: sin eso una tabla
 * o un texto largo estira el flex y desborda la pantalla (el bug de scroll horizontal
 * que ya se pago una vez en este repo).
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { resuelto, autenticado } = useSuperAdmin();

  if (!resuelto || !autenticado) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Mobile (<1024px): barra superior con hamburguesa. En desktop se oculta. */}
      <BarraSuperadminMobile />
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
