import { notFound } from 'next/navigation';
import { DevUi } from '../../../components/dev-ui';

/**
 * Banco de pruebas visual (solo desarrollo).
 *
 * En produccion la ruta NO existe: devuelve 404. Se chequea en el render de
 * servidor, asi que tampoco se filtra nada de esto al bundle de produccion.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <DevUi />;
}
