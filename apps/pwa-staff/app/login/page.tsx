'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_TENANT } from '@/lib/constants';
import { rutaLogin } from '@/lib/tenant';

/**
 * Compatibilidad de `/login` (la URL vieja, sin slug) SIN romper el healthcheck.
 *
 * POR QUE NO UN REDIRECT: el healthcheck de Railway pega a `/login` y rechaza cualquier 3xx, asi que
 * un `redirect()` del config o del middleware dejaba el deploy en FAILED ("Attempt #1 failed with
 * HTTP 308 … 1/1 replicas never became healthy"). Esta pagina devuelve **200** y reenvia desde el
 * cliente, que es lo unico que hace falta: los bookmarks y los links viejos siguen entrando por
 * `/login` y terminan en el login del tenant por defecto.
 *
 * El tenant por defecto sale de `NEXT_PUBLIC_DEFAULT_TENANT`: el dia que haya 2+ locales activos,
 * esta pagina se puede borrar (nadie deberia entrar sin slug).
 */
export default function LoginSinTenantPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace(rutaLogin(DEFAULT_TENANT));
  }, [router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">Entrando al local…</p>
      <a className="text-sm underline underline-offset-4" href={rutaLogin(DEFAULT_TENANT)}>
        Continuar
      </a>
    </main>
  );
}
