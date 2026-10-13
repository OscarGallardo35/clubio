'use client';

import { BottomSheet } from '@repo/ui';
import { BotonCerrarSesion, NavSuperadmin } from '@/components/NavSuperadmin';

/**
 * Menu de navegacion del panel en mobile: el MISMO listado del sidebar
 * (`NavSuperadmin`) dentro del `BottomSheet` de `@repo/ui`.
 *
 * BottomSheet y no un drawer lateral: ya es el patron mobile establecido del repo y
 * trae la a11y resuelta (role=dialog, focus trap, Escape, bloqueo del scroll del body
 * via @radix-ui/react-dialog) sin sumar dependencias.
 */
export function MenuSuperadminMobile({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <BottomSheet abierto={abierto} onCerrar={onCerrar} titulo="Menu">
      <NavSuperadmin onNavegar={onCerrar} />
      <div className="mt-4">
        <BotonCerrarSesion onClick={onCerrar} />
      </div>
    </BottomSheet>
  );
}
