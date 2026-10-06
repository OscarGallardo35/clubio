import { notFound } from 'next/navigation';
import { DevCarrito } from '../../../components/dev-carrito';

/**
 * Banco de pruebas del carrito (solo desarrollo).
 *
 * Mismo criterio que /dev/ui: en produccion la ruta no existe (404) y se chequea en el render de
 * servidor, asi que nada de esto entra al bundle de produccion.
 */
export default function DevCarritoPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <DevCarrito />;
}
