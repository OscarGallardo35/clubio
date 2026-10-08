import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ingresar' };

/**
 * Placeholder del login (la Fase 1 lo implementa).
 *
 * Existe ya por dos razones concretas: el `middleware` redirige SIN cookie a `/login`, y el
 * healthcheck de Railway apunta ahi — tiene que responder 200 aunque el formulario no este.
 *
 * El login real: email + password -> `{ requiere2FA, challengeToken }` (5 min) ->
 * `POST /auth/dueno/verificar-2fa` -> cookie HttpOnly `dueno_token`.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">Panel del local</p>
      </header>
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        <p>El ingreso con email + 2FA llega en la Fase 1.</p>
      </div>
    </main>
  );
}
