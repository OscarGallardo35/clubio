import type { Metadata } from 'next';
import { FormularioLogin } from '@/components/FormularioLogin';

export const metadata: Metadata = { title: 'Ingresar' };

/**
 * Pagina de login (SERVER component): lee `volver` de la URL y se lo pasa al
 * formulario como prop. El formulario es el client component.
 */
export default function LoginPage({
  params,
  searchParams,
}: {
  params: { tenant: string };
  searchParams?: { volver?: string };
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-sm text-muted-foreground">
          Ingresa con el PIN · <span className="font-medium">{params.tenant}</span>
        </p>
      </header>
      <FormularioLogin tenant={params.tenant} volver={searchParams?.volver} />
    </main>
  );
}
