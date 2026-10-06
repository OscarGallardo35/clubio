import { redirect } from 'next/navigation';

/** El dashboard es /turnos: la raiz solo redirige. */
export default function Inicio() {
  redirect('/turnos');
}
