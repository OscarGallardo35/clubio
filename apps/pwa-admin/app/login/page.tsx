'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@repo/ui';
import { rutaLogin, tenantDePath } from '@/lib/tenant';

/**
 * Entrada SIN slug (`/login`): la URL vieja, sin local en el path.
 *
 * Antes esta pagina hacia `router.replace(rutaLogin(DEFAULT_TENANT))`, o sea que aterrizaba en
 * `bar-la-esquina` (el slug del seed) a CUALQUIERA que entrara sin slug: el dueno de otro local
 * caia en el login del seed y sus credenciales daban 401. Ahora NO se elige un local en silencio.
 *
 * - Si ya hay sesion, el middleware redirige al negocio DEL TOKEN (`slugDelToken`) antes de que
 *   esta pagina se renderice; aca no hay que hacer nada (la cookie es HttpOnly, el cliente no la
 *   puede leer).
 * - Si no hay sesion, se muestra este selector: el dueno escribe el slug de su local y entra a
 *   `/<slug>/login`. El slug se valida con el MISMO criterio que el resto del admin
 *   (`tenantDePath`: minusculas, numeros y guiones, y sin las palabras reservadas).
 *
 * La pagina devuelve **200** (no `redirect()`): el healthcheck de Railway pega a `/login` y un 3xx
 * lo deja en FAILED. El unico 3xx posible sale del middleware y solo con cookie de sesion, que el
 * healthcheck nunca manda.
 */
export default function LoginSinTenantPage() {
  const router = useRouter();
  const [slug, setSlug] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const limpio = slug.trim().toLowerCase();
  // Reusa el MISMO criterio de slug del admin: valida formato + lista de reservados.
  const valido = tenantDePath(`/${limpio}`);
  const puedeEntrar = valido !== null;

  function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!valido) {
      setError('Ese no parece un local valido. Revisá el link que te pasamos.');
      return;
    }
    router.push(rutaLogin(valido));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Este panel es multi-local: cada local tiene su propia dirección.
        </p>
      </header>

      <form onSubmit={entrar} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="slug">Nombre del local</Label>
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="mi-local"
            required
          />
          <p className="text-xs text-muted-foreground">
            Es la parte que va antes de <code>/login</code> en el link del panel.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!puedeEntrar} className="min-h-12 w-full">
          Ir al panel de mi local
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Entrá siempre con el link de tu local: <code>admin.clubio.lat/&lt;local&gt;/login</code>.
      </p>
    </main>
  );
}
