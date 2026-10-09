'use client';

import { BottomSheet } from '@repo/ui';
import { BotonCerrarSesion, NavAdmin } from '@/components/NavAdmin';

/**
 * Menu de navegacion del admin en mobile: el MISMO listado del sidebar (`NavAdmin`) dentro del
 * `BottomSheet` de `@repo/ui`.
 *
 * Por que BottomSheet y no un drawer lateral: ya es el patron mobile establecido del repo y trae la
 * a11y resuelta (`role=dialog`, `aria-modal`, focus trap, Escape y bloqueo del scroll del body via
 * `@radix-ui/react-dialog`) sin sumar dependencias.
 *
 * Se cierra: al tocar un item (navega y cierra), al tocar afuera/backdrop, con Escape y con swipe
 * hacia abajo.
 */
export function MenuAdminMobile({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <BottomSheet abierto={abierto} onCerrar={onCerrar} titulo="Menu">
      <NavAdmin onNavegar={onCerrar} />
      <div className="mt-4">
        <BotonCerrarSesion onClick={onCerrar} />
      </div>
    </BottomSheet>
  );
}
