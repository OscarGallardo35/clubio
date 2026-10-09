'use client'

import * as React from 'react';
import { Skeleton } from '@repo/ui';
import { BottomNav } from '@/components/BottomNav';
import { useEmpleado } from '@/hooks/useEmpleado';

/**
 * Layout de las pantallas con sesion (todo menos /login).
 *
 * El estado "resolviendo sesion" es obligatorio: sin el, la pantalla entra en
 * "no autenticado" durante el primer render (el GET /me todavia no volvio) y el
 * empleado ve un parpadeo de login antes del dashboard.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const { resuelto, autenticado } = useEmpleado();

  if (!resuelto) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  // Sin sesion: el hook ya disparo el redirect a /login. Se evita mostrar el
  // dashboard un instante (y el flash de "no autenticado").
  if (!autenticado) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  return (
    <>
      {/* pb-24 (96px) deja lugar para la barra fija + la safe-area. Con `env()` la cuenta es real:
          un iPhone con notch tiene ~34px de safe-area y 56px de barra = 90px, justo al limite. */}
      {/* overflow-x-clip: red de seguridad. Si alguna pantalla vuelve a meter un hijo mas ancho que el
          contenedor (el caso `w-max` del TabsList de pedidos), el desborde horizontal agrandaba el
          viewport y empujaba la barra fija fuera de la vista. `clip` (no `hidden`) NO crea scroll
          container, asi no toca los footers `sticky` de los sheets (que ademas son `fixed` y escapan
          al clip). El nav es hermano de este div, asi que no lo recorta nunca. */}
      <div className="mx-auto w-full max-w-md overflow-x-clip pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</div>
      <BottomNav />
    </>
  );
}
