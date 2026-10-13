import type { Metadata } from 'next';
import { FormularioLogin } from '@/components/FormularioLogin';

export const metadata: Metadata = { title: 'Ingresar' };

/**
 * Login del operador (SERVER component): lee `volver` de la URL y se lo pasa al
 * formulario como prop. El formulario es el client component.
 *
 * El paso de 2FA NO tiene URL propia: el `challengeToken` viaja por estado del
 * formulario, no por query (una credencial temporal en la barra de direcciones termina
 * en el historial, en los logs del proxy y en el `Referer`).
 */
export default function LoginPage({ searchParams }: { searchParams?: { volver?: string } }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Operador de plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Panel interno: locales y demos de Clubio
        </p>
      </header>
      <FormularioLogin volver={searchParams?.volver} />
    </main>
  );
}
